// Petits utilitaires partagés.

export const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const uuid = () =>
  crypto.randomUUID ? crypto.randomUUID()
  : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });

const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const MONTHS_LONG = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export const fmtDate = (iso) => {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
};
export const fmtShort = (iso) => {
  const [, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}`;
};
export const fmtDateTime = (ts) => {
  const d = new Date(ts);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()} à ${String(d.getHours()).padStart(2, "0")}h${String(d.getMinutes()).padStart(2, "0")}`;
};
export const monthLabel = (ym) => {
  const [y, m] = ym.split("-").map(Number);
  return `${MONTHS_LONG[m - 1]} ${y}`;
};
export const monthShort = (ym) => MONTHS[Number(ym.slice(5, 7)) - 1];

export const fmtNum = (n, d = 0) =>
  n == null || Number.isNaN(n) ? "—" : Number(n).toLocaleString("fr-BE", { maximumFractionDigits: d, minimumFractionDigits: 0 });
export const fmtPct = (x) => (x == null || Number.isNaN(x) ? "—" : `${Math.round(x * 100)} %`);
export const fmtHours = (min) => {
  if (!min) return "0 h";
  const h = min / 60;
  return h < 10 ? `${fmtNum(h, 1)} h` : `${fmtNum(Math.round(h))} h`;
};
export const fmtScore = (s) => (s == null || s === "" ? "—" : fmtNum(Number(s), 2));

export const plural = (n, one, many) => `${fmtNum(n)} ${n > 1 ? many : one}`;

export const debounce = (fn, ms = 300) => {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
};

export const initials = (name) =>
  String(name || "?").replace(/^(les?|la|l'|the)\s+/i, "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

// Couleurs par défaut des joueurs (ordre fixe, validé daltonisme)
export const PLAYER_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"];

export const MODES = {
  competitive: "Compétitif",
  teams: "Équipes",
  coop: "Coopératif",
  solo: "Solo",
};
export const STATUS = { owned: "Possédé", elsewhere: "Joué ailleurs", lent: "Prêté" };
export const SCORE_RULES = { high: "Le plus haut gagne", low: "Le plus bas gagne", none: "Sans score" };

let toastTimer;
export function toast(msg, kind = "info") {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = "toast"), kind === "error" ? 5000 : 2600);
}

export function confirmDialog(message, okLabel = "Confirmer", danger = true) {
  return new Promise((resolve) => {
    const dlg = document.getElementById("dialog");
    dlg.innerHTML = `<form method="dialog" class="dlg">
      <p>${esc(message)}</p>
      <div class="dlg-actions">
        <button value="cancel" class="btn ghost">Annuler</button>
        <button value="ok" class="btn ${danger ? "danger" : "primary"}">${esc(okLabel)}</button>
      </div></form>`;
    dlg.onclose = () => resolve(dlg.returnValue === "ok");
    dlg.showModal();
  });
}

// Choisit un nom français probable parmi les noms BGG (BGG n'indique pas la langue).
export function guessFrenchName(primary, names = []) {
  const fr = /^(les?|la|l'|l’|une?|des|du|aux?)\s|[éèêàçùôîâœ]|\b(et|de|des|du|château|châteaux|chasse|trésor|jeu)\b/i;
  const cand = names.filter((n) => n && n !== primary && fr.test(n) && !/[Ѐ-ӿ぀-ヿ一-鿿가-힯]/.test(n));
  return cand[0] || primary;
}

// Prépare une photo choisie dans la photothèque ou prise à l'appareil : JPEG réduit + vignette (data URL).
// La photo complète fait au plus `max` px de côté (≈ 200 à 400 Ko), la vignette 360 px (≈ 20 Ko).
export async function preparePhoto(file, max = 1600) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, ko) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => ko(new Error(`Image illisible : ${file.name || "photo"}`));
      i.src = url;
    });
    const draw = (size, quality) => {
      const r = Math.min(1, size / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement("canvas");
      c.width = Math.round(img.naturalWidth * r); c.height = Math.round(img.naturalHeight * r);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      return c.toDataURL("image/jpeg", quality);
    };
    return { full: draw(max, 0.82), thumb: draw(360, 0.7) };
  } finally { URL.revokeObjectURL(url); }
}
