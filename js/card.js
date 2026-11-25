// Carte résultat d'une partie, dessinée dans un canvas (PNG 1080 px de large) pour être partagée.
// Contenu : photo de la partie (s'il y en a), pochette, jeu, date, classement ou résultat coopératif.
import { MODES, fmtDate, fmtScore, initials } from "./util.js";

const W = 1080, PAD = 72;
const FONT = '-apple-system, "SF Pro Display", system-ui, "Segoe UI", Roboto, sans-serif';

const loadImg = (src) => new Promise((ok) => {
  if (!src) return ok(null);
  const i = new Image();
  i.onload = () => ok(i);
  i.onerror = () => ok(null);
  i.src = src;
});

function cover(ctx, img, x, y, w, h) { // remplit la zone sans déformer (recadrage centré)
  const r = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const sw = w / r, sh = h / r;
  ctx.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, x, y, w, h);
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function fit(ctx, text, max) { // coupe le texte trop long avec « … »
  if (ctx.measureText(text).width <= max) return text;
  while (text.length > 1 && ctx.measureText(text + "…").width > max) text = text.slice(0, -1);
  return text + "…";
}

// play : partie ; game : jeu ; name(id) : nom du joueur ; color(id) : couleur ; photo : data URL ou null
export async function resultCard({ play, game, name, color, photo }) {
  const [photoImg, coverImg] = await Promise.all([loadImg(photo), loadImg(game?.cover)]);
  const coop = play.mode === "coop" || play.mode === "solo";

  // Lignes du résultat
  let rows;
  if (play.mode === "teams") {
    const teams = new Map();
    play.players.forEach((x) => { const t = x.team || "Sans équipe"; if (!teams.has(t)) teams.set(t, []); teams.get(t).push(x); });
    rows = [...teams.entries()].sort((a, b) => (a[1][0].rank ?? 99) - (b[1][0].rank ?? 99)).map(([t, xs]) => ({
      rank: xs[0].rank, label: t, sub: xs.map((x) => name(x.player_id)).join(", "), score: xs[0].score, win: xs[0].is_winner, color: null,
    }));
  } else {
    rows = [...play.players].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99)).map((x) => ({
      rank: coop ? null : x.rank, label: name(x.player_id), score: x.score, win: !coop && x.is_winner, color: color(x.player_id),
    }));
  }
  const rowH = (r) => (r.sub ? 118 : 92);
  const photoH = photoImg ? 620 : 0;
  const headH = 250, bannerH = coop ? 120 : 0, footH = 120;
  const H = photoH + headH + bannerH + rows.reduce((s, r) => s + rowH(r), 0) + footH;

  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#f6f4ef"; ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = "middle";

  let y = 0;
  if (photoImg) { cover(ctx, photoImg, 0, 0, W, photoH); y = photoH; }

  // En-tête : pochette + nom du jeu + date
  const cs = 150, cy = y + 50;
  ctx.save(); roundRect(ctx, PAD, cy, cs, cs, 28); ctx.clip();
  if (coverImg) cover(ctx, coverImg, PAD, cy, cs, cs);
  else {
    ctx.fillStyle = "#e3eefb"; ctx.fillRect(PAD, cy, cs, cs);
    ctx.fillStyle = "#2a78d6"; ctx.font = `700 60px ${FONT}`; ctx.textAlign = "center";
    ctx.fillText(initials(game?.name || "?"), PAD + cs / 2, cy + cs / 2 + 2); ctx.textAlign = "left";
  }
  ctx.restore();
  const tx = PAD + cs + 36, tw = W - tx - PAD;
  ctx.fillStyle = "#1b1a17"; ctx.font = `700 58px ${FONT}`;
  ctx.fillText(fit(ctx, game?.name || "Partie", tw), tx, cy + 52);
  ctx.fillStyle = "#7a776f"; ctx.font = `400 36px ${FONT}`;
  ctx.fillText(fit(ctx, `${fmtDate(play.played_at)} · ${MODES[play.mode] || ""}${play.duration_min ? ` · ${play.duration_min} min` : ""}`, tw), tx, cy + 112);
  y += headH;

  // Résultat coopératif / solo
  if (coop) {
    const win = play.coop_result === "win";
    roundRect(ctx, PAD, y, W - 2 * PAD, 92, 22);
    ctx.fillStyle = win ? "#e1f3e1" : "#f8e3e3"; ctx.fill();
    ctx.fillStyle = win ? "#0c8a0c" : "#d03b3b"; ctx.font = `700 44px ${FONT}`;
    ctx.fillText(`${win ? "🏆 Victoire" : "Défaite"}${play.mode === "coop" ? " collective" : ""}`, PAD + 32, y + 47);
    y += bannerH;
  }

  // Classement
  for (const r of rows) {
    const h = rowH(r);
    if (r.win) { roundRect(ctx, PAD - 20, y + 6, W - 2 * PAD + 40, h - 12, 22); ctx.fillStyle = "#fdf1d6"; ctx.fill(); }
    let x = PAD;
    if (!coop) {
      ctx.fillStyle = "#7a776f"; ctx.font = `600 40px ${FONT}`;
      ctx.fillText(r.rank ?? "–", x, y + (r.sub ? 42 : h / 2)); x += 62;
    }
    if (r.color) { ctx.beginPath(); ctx.arc(x + 14, y + h / 2, 14, 0, Math.PI * 2); ctx.fillStyle = r.color; ctx.fill(); x += 48; }
    const scoreTxt = r.score != null && r.score !== "" ? fmtScore(r.score) : "";
    ctx.font = `600 40px ${FONT}`;
    const sw = scoreTxt ? ctx.measureText(scoreTxt).width : 0;
    ctx.fillStyle = "#1b1a17"; ctx.font = `${r.win ? 700 : 500} 44px ${FONT}`;
    const label = fit(ctx, r.label + (r.win ? "  🏆" : ""), W - PAD - x - sw - 40);
    ctx.fillText(label, x, y + (r.sub ? 42 : h / 2));
    if (r.sub) { ctx.fillStyle = "#52514e"; ctx.font = `400 32px ${FONT}`; ctx.fillText(fit(ctx, r.sub, W - PAD - x - sw - 40), x, y + 86); }
    if (scoreTxt) {
      ctx.fillStyle = "#1b1a17"; ctx.font = `600 40px ${FONT}`; ctx.textAlign = "right";
      ctx.fillText(scoreTxt, W - PAD, y + (r.sub ? 42 : h / 2)); ctx.textAlign = "left";
    }
    y += h;
  }

  // Pied
  ctx.fillStyle = "#b3afa5"; ctx.font = `600 30px ${FONT}`; ctx.textAlign = "center";
  ctx.fillText(`C-Party${play.is_learning ? " · partie d'apprentissage" : ""}`, W / 2, H - 60);
  return new Promise((ok, ko) => c.toBlob((b) => (b ? ok(b) : ko(new Error("Image impossible à créer"))), "image/png"));
}
