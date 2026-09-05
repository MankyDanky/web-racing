// Human-like identities for AI drivers. Kept dependency-free so the lobby
// can build a fake roster without pulling the physics stack into its bundle.

const BOT_NAMES = [
  'Arnav_217', 'ria.speed', 'KartikPro', 'noob_slayer99', 'Aisha_rx',
  'DriftKing_IN', 'meera_04', 'RohanOP', 'pixel_pete', 'ZoyaFast',
  'nikhil.gg', 'TurboTara', 'sam_drift', 'Ishaan_07', 'leo_lag', 'AnayaAce',
];

const BOT_COLORS = ['orange', 'yellow', 'green', 'blue', 'indigo', 'violet'];

const CHAT_ON_FINISH = ['gg', 'gg wp', 'nice race!', 'that last corner tho', 'rematch?'];

export function makeBotRoster(count) {
  const names = [...BOT_NAMES].sort(() => Math.random() - 0.5);
  const colors = [...BOT_COLORS].sort(() => Math.random() - 0.5);
  const n = Math.max(0, Math.min(5, count | 0));
  return Array.from({ length: n }, (_, i) => ({
    id: 'bot-' + i,
    name: names[i % names.length],
    playerColor: colors[i % colors.length],
    isHost: false,
    isBot: true,
  }));
}

export function randomFinishChat() {
  return Math.random() < 0.45
    ? CHAT_ON_FINISH[Math.floor(Math.random() * CHAT_ON_FINISH.length)]
    : null;
}
