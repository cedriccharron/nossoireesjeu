// C-Party — stockage iCloud (CloudKit) exposé au JavaScript sous le nom « CloudStore ».
//
// Modèle : une zone « CParty » dans la base PRIVÉE du propriétaire, partagée en entier
// (CKShare de zone). Les invités la voient dans leur base PARTAGÉE.
// Chaque enregistrement porte un champ « json » : l'objet complet côté JavaScript.
// Les photos (type « Photo ») ont en plus un champ « image » (CKAsset), lu seulement à la demande.
// Toute la logique métier reste en JavaScript (js/store-icloud.js) ; ce fichier ne fait que
// lire, écrire (atomiquement) et gérer le partage.

import Foundation
import UIKit
import CloudKit
import Capacitor

// MARK: - Contrôleur principal : enregistre le module au démarrage

class CPartyViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(CloudStorePlugin())
    }
}

// MARK: - Accès CloudKit

final class CloudSpace {
    static let shared = CloudSpace()
    static let zoneName = "CParty"
    static let containerID = "iCloud.com.cedriccharron.nossoireesjeu"

    let container = CKContainer(identifier: CloudSpace.containerID)
    var privateDB: CKDatabase { container.privateCloudDatabase }
    var sharedDB: CKDatabase { container.sharedCloudDatabase }

    /// Prévenu quand l'espace change (invitation acceptée, espace quitté…).
    var onChange: (() -> Void)?

    struct Active {
        let db: CKDatabase
        let zoneID: CKRecordZone.ID
        let isOwner: Bool
    }

    /// Espace actif : celui dont on est propriétaire, sinon le premier espace partagé avec nous.
    func active() async throws -> Active? {
        let ownZone = CKRecordZone.ID(zoneName: CloudSpace.zoneName, ownerName: CKCurrentUserDefaultName)
        do {
            _ = try await privateDB.recordZone(for: ownZone)
            return Active(db: privateDB, zoneID: ownZone, isOwner: true)
        } catch let e as CKError where e.code == .zoneNotFound || e.code == .unknownItem {
            // pas d'espace à nous : on regarde les espaces partagés
        }
        let zones = try await sharedDB.allRecordZones()
        if let z = zones.first(where: { $0.zoneID.zoneName == CloudSpace.zoneName }) {
            return Active(db: sharedDB, zoneID: z.zoneID, isOwner: false)
        }
        return nil
    }

    func requireActive() async throws -> Active {
        guard let a = try await active() else {
            throw NSError(domain: "CParty", code: 1, userInfo: [NSLocalizedDescriptionKey: "Aucun espace C-Party : crée-le ou accepte une invitation"])
        }
        return a
    }

    func zoneShare(_ a: Active) async throws -> CKShare? {
        let id = CKRecord.ID(recordName: CKRecordNameZoneWideShare, zoneID: a.zoneID)
        do {
            return try await a.db.record(for: id) as? CKShare
        } catch let e as CKError where e.code == .unknownItem {
            return nil
        }
    }

    func createSpace() async throws {
        let zone = CKRecordZone(zoneName: CloudSpace.zoneName)
        _ = try await privateDB.modifyRecordZones(saving: [zone], deleting: [])
    }

    func fetchAll(_ a: Active) async throws -> [CKRecord] {
        var out: [CKRecord] = []
        var token: CKServerChangeToken? = nil
        var more = true
        while more {
            // Seul le champ « json » est téléchargé : les images des photos restent dans iCloud.
            let r = try await a.db.recordZoneChanges(inZoneWith: a.zoneID, since: token, desiredKeys: ["json"])
            for (_, res) in r.modificationResultsByID {
                if case .success(let m) = res, !(m.record is CKShare) { out.append(m.record) }
            }
            token = r.changeToken
            more = r.moreComing
        }
        return out
    }

    /// Écrit et supprime en une seule opération : tout passe ou rien ne passe.
    func modify(_ a: Active, save: [(type: String, name: String, json: String, image: Data?)], remove: [String]) async throws {
        var files: [URL] = []
        defer { files.forEach { try? FileManager.default.removeItem(at: $0) } }
        let records: [CKRecord] = try save.map { item in
            let r = CKRecord(recordType: item.type, recordID: CKRecord.ID(recordName: item.name, zoneID: a.zoneID))
            r["json"] = item.json as CKRecordValue
            if let data = item.image {
                let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".jpg")
                try data.write(to: url)
                files.append(url)
                r["image"] = CKAsset(fileURL: url)
            }
            return r
        }
        let ids = remove.map { CKRecord.ID(recordName: $0, zoneID: a.zoneID) }
        let res = try await a.db.modifyRecords(saving: records, deleting: ids, savePolicy: .allKeys, atomically: true)
        for (_, r) in res.saveResults { if case .failure(let e) = r { throw e } }
        for (id, r) in res.deleteResults {
            if case .failure(let e) = r, (e as? CKError)?.code != .unknownItem { _ = id; throw e }
        }
    }

    /// Image complète d'une photo (JPEG).
    func image(_ a: Active, name: String) async throws -> Data {
        let id = CKRecord.ID(recordName: name, zoneID: a.zoneID)
        let res = try await a.db.records(for: [id], desiredKeys: ["image"])
        guard case .success(let r)? = res[id], let asset = r["image"] as? CKAsset, let url = asset.fileURL else {
            throw NSError(domain: "CParty", code: 3, userInfo: [NSLocalizedDescriptionKey: "Photo introuvable"])
        }
        return try Data(contentsOf: url)
    }

    func shareForSharing(_ a: Active) async throws -> CKShare {
        if let s = try await zoneShare(a) { return s }
        guard a.isOwner else {
            throw NSError(domain: "CParty", code: 2, userInfo: [NSLocalizedDescriptionKey: "Seul le propriétaire de l'espace peut inviter"])
        }
        let share = CKShare(recordZoneID: a.zoneID)
        share[CKShare.SystemFieldKey.title] = "C-Party" as CKRecordValue
        share.publicPermission = .none
        let res = try await privateDB.modifyRecords(saving: [share], deleting: [])
        if case .success(let saved as CKShare)? = res.saveResults.values.first { return saved }
        return share
    }

    func accept(_ metadata: CKShare.Metadata) async {
        do {
            _ = try await container.accept(metadata)
        } catch {
            NSLog("C-Party : invitation non acceptée — \(error)")
        }
        await MainActor.run { self.onChange?() }
    }

    /// Invité : quitte l'espace partagé. Propriétaire : supprime l'espace et toutes ses données.
    func leaveOrDelete(_ a: Active) async throws {
        _ = try await a.db.modifyRecordZones(saving: [], deleting: [a.zoneID])
    }
}

// MARK: - Module Capacitor

@objc(CloudStorePlugin)
public class CloudStorePlugin: CAPPlugin, CAPBridgedPlugin, UICloudSharingControllerDelegate {
    public let identifier = "CloudStorePlugin"
    public let jsName = "CloudStore"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "createSpace", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "fetchAll", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "modify", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "image", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "shareFile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "participants", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "manageSharing", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "invite", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "leaveSpace", returnType: CAPPluginReturnPromise),
    ]

    private let space = CloudSpace.shared

    override public func load() {
        space.onChange = { [weak self] in self?.notifyListeners("spaceChanged", data: [:]) }
    }

    private func run(_ call: CAPPluginCall, _ work: @escaping () async throws -> [String: Any]) {
        Task {
            do { call.resolve(try await work()) }
            catch { call.reject(Self.message(for: error), nil, error) }
        }
    }

    @objc func status(_ call: CAPPluginCall) {
        run(call) {
            let st = try await self.space.container.accountStatus()
            guard st == .available else { return ["account": Self.name(st)] }
            let me = try await self.space.container.userRecordID().recordName
            guard let a = try await self.space.active() else { return ["account": "available", "user": me] }
            var permission = "readWrite"
            if !a.isOwner, let share = try await self.space.zoneShare(a) {
                permission = share.currentUserParticipant?.permission == .readWrite ? "readWrite" : "readOnly"
            }
            return ["account": "available", "user": me,
                    "space": ["owner": a.isOwner, "permission": permission]]
        }
    }

    @objc func createSpace(_ call: CAPPluginCall) {
        run(call) { try await self.space.createSpace(); return [:] }
    }

    @objc func fetchAll(_ call: CAPPluginCall) {
        run(call) {
            let a = try await self.space.requireActive()
            let recs = try await self.space.fetchAll(a)
            return ["records": recs.map { r -> [String: Any] in
                ["type": r.recordType, "name": r.recordID.recordName, "json": (r["json"] as? String) ?? "null"]
            }]
        }
    }

    @objc func modify(_ call: CAPPluginCall) {
        // « image » (facultatif) : JPEG encodé en base64, enregistré comme CKAsset.
        let save = (call.getArray("save") as? [[String: Any]] ?? []).compactMap { d -> (type: String, name: String, json: String, image: Data?)? in
            guard let t = d["type"] as? String, let n = d["name"] as? String, let j = d["json"] as? String else { return nil }
            return (t, n, j, (d["image"] as? String).flatMap { Data(base64Encoded: $0) })
        }
        let remove = call.getArray("remove") as? [String] ?? []
        run(call) {
            let a = try await self.space.requireActive()
            try await self.space.modify(a, save: save, remove: remove)
            return [:]
        }
    }

    @objc func image(_ call: CAPPluginCall) {
        let name = call.getString("name") ?? ""
        run(call) {
            let a = try await self.space.requireActive()
            return ["data": try await self.space.image(a, name: name).base64EncodedString()]
        }
    }

    /// Partage d'un fichier (export CSV, carte résultat) : feuille de partage d'iOS
    /// (Enregistrer dans Fichiers, Messages, Mail…). data = contenu en base64.
    @objc func shareFile(_ call: CAPPluginCall) {
        let name = (call.getString("name") ?? "c-party").replacingOccurrences(of: "/", with: "-")
        guard let data = call.getString("data").flatMap({ Data(base64Encoded: $0) }) else {
            call.reject("Fichier vide"); return
        }
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("partage", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent(name)
        do { try data.write(to: url, options: .atomic) } catch { call.reject("Impossible de préparer le fichier"); return }
        DispatchQueue.main.async {
            guard let vc = self.bridge?.viewController else { call.reject("Écran indisponible"); return }
            let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
            sheet.popoverPresentationController?.sourceView = vc.view
            sheet.completionWithItemsHandler = { _, done, _, _ in call.resolve(["shared": done]) }
            vc.present(sheet, animated: true)
        }
    }

    @objc func participants(_ call: CAPPluginCall) {
        run(call) {
            let a = try await self.space.requireActive()
            guard let share = try await self.space.zoneShare(a) else { return ["participants": []] }
            let me = try await self.space.container.userRecordID().recordName
            let list: [[String: Any]] = share.participants.map { p in
                // Le propriétaire (ou l'utilisateur courant) peut apparaître sous « __defaultOwner__ » :
                // on renvoie toujours le vrai identifiant, celui que donne status().
                var user = p.userIdentity.userRecordID?.recordName ?? ""
                if user == CKCurrentUserDefaultName || p == share.currentUserParticipant { user = me }
                let n = p.userIdentity.nameComponents
                let name = n.map { PersonNameComponentsFormatter.localizedString(from: $0, style: .default) } ?? ""
                return [
                    "user": user,
                    "name": name,
                    "email": p.userIdentity.lookupInfo?.emailAddress ?? "",
                    "owner": p.role == .owner,
                    "permission": p.permission == .readWrite ? "readWrite" : "readOnly",
                    "accepted": p.acceptanceStatus == .accepted,
                ]
            }
            return ["participants": list]
        }
    }

    /// Ouvre l'écran de partage d'Apple : inviter, changer les droits, retirer quelqu'un.
    @objc func manageSharing(_ call: CAPPluginCall) {
        Task {
            do {
                let a = try await space.requireActive()
                let share = try await space.shareForSharing(a)
                await MainActor.run {
                    let c = UICloudSharingController(share: share, container: self.space.container)
                    c.availablePermissions = [.allowPrivate, .allowReadOnly, .allowReadWrite]
                    c.delegate = self
                    guard let vc = self.bridge?.viewController else { call.reject("Écran indisponible"); return }
                    c.popoverPresentationController?.sourceView = vc.view
                    vc.present(c, animated: true) { call.resolve() }
                }
            } catch {
                call.reject(Self.message(for: error), nil, error)
            }
        }
    }

    /// Envoie une invitation dont l'autorisation est fixée par l'app :
    /// role = "readOnly" (joueur) ou "readWrite" (gestionnaire). Accès réservé aux personnes invitées.
    @objc func invite(_ call: CAPPluginCall) {
        let readWrite = call.getString("role") == "readWrite"
        Task {
            do {
                let a = try await space.requireActive()
                guard a.isOwner else {
                    throw NSError(domain: "CParty", code: 2, userInfo: [NSLocalizedDescriptionKey: "Seul le propriétaire du groupe peut inviter"])
                }
                let share = try await space.shareForSharing(a)
                await MainActor.run {
                    guard let vc = self.bridge?.viewController else { call.reject("Écran indisponible"); return }
                    let sheet: UIViewController
                    if #available(iOS 16.0, *) {
                        let provider = NSItemProvider()
                        let options = CKAllowedSharingOptions(
                            allowedParticipantPermissionOptions: readWrite ? .readWrite : .readOnly,
                            allowedParticipantAccessOptions: .specifiedRecipientsOnly)
                        provider.registerCKShare(share, container: self.space.container, allowedSharingOptions: options)
                        sheet = UIActivityViewController(activityItemsConfiguration: UIActivityItemsConfiguration(itemProviders: [provider]))
                    } else {
                        let c = UICloudSharingController(share: share, container: self.space.container)
                        c.availablePermissions = [.allowPrivate, readWrite ? .allowReadWrite : .allowReadOnly]
                        c.delegate = self
                        sheet = c
                    }
                    sheet.popoverPresentationController?.sourceView = vc.view
                    vc.present(sheet, animated: true) { call.resolve() }
                }
            } catch {
                call.reject(Self.message(for: error), nil, error)
            }
        }
    }

    @objc func leaveSpace(_ call: CAPPluginCall) {
        run(call) {
            let a = try await self.space.requireActive()
            try await self.space.leaveOrDelete(a)
            return [:]
        }
    }

    // UICloudSharingControllerDelegate
    public func itemTitle(for csc: UICloudSharingController) -> String? { "C-Party" }
    public func cloudSharingController(_ csc: UICloudSharingController, failedToSaveShareWithError error: Error) {
        notifyListeners("sharingError", data: ["message": Self.message(for: error)])
    }
    public func cloudSharingControllerDidSaveShare(_ csc: UICloudSharingController) {
        notifyListeners("spaceChanged", data: [:])
    }
    public func cloudSharingControllerDidStopSharing(_ csc: UICloudSharingController) {
        notifyListeners("spaceChanged", data: [:])
    }

    // MARK: Messages en français

    static func name(_ s: CKAccountStatus) -> String {
        switch s {
        case .available: return "available"
        case .noAccount: return "noAccount"
        case .restricted: return "restricted"
        case .temporarilyUnavailable: return "temporarilyUnavailable"
        default: return "couldNotDetermine"
        }
    }

    static func message(for error: Error) -> String {
        guard let e = error as? CKError else { return error.localizedDescription }
        switch e.code {
        case .notAuthenticated: return "Connecte-toi à iCloud dans Réglages pour utiliser C-Party"
        case .networkUnavailable, .networkFailure: return "Pas de connexion Internet"
        case .permissionFailure: return "Tu n'as pas le droit de modifier ces données"
        case .quotaExceeded: return "Stockage iCloud plein"
        case .serviceUnavailable, .requestRateLimited, .zoneBusy: return "iCloud est occupé, réessaie dans un instant"
        case .partialFailure:
            if let first = e.partialErrorsByItemID?.values.first { return message(for: first) }
            return "L'enregistrement a échoué"
        case .participantMayNeedVerification: return "Ton invitation doit être vérifiée : ouvre le lien reçu"
        case .zoneNotFound, .userDeletedZone: return "L'espace C-Party n'existe plus"
        default: return e.localizedDescription
        }
    }
}
