const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

function parseCustomEmoji(input) {
  const match = input.match(/<(a?):\w+:(\d+)>/);
  if (!match) return null;
  const isAnimated = match[1] === 'a';
  const id = match[2];
  const ext = isAnimated ? 'gif' : 'png';
  return `https://cdn.discordapp.com/emojis/${id}.${ext}`;
}

function parseUnicodeEmoji(input) {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const codePoints = Array.from(trimmed).map(char => char.codePointAt(0).toString(16)).join('-');
  if (!codePoints) return null;
  return `https://twemoji.maxcdn.com/v/latest/72x72/${codePoints}.png`;
}

async function fetchImageBuffer(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`فشل تحميل الصورة: ${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function resolveIconBuffer(input, attachments = []) {
  if (attachments && attachments.length > 0) {
    const attachmentUrl = attachments[0].url;
    return fetchImageBuffer(attachmentUrl);
  }

  if (!input) return null;

  const tokens = input.trim().split(/\s+/).filter(Boolean);
  const candidates = tokens.length > 0 ? tokens : [input.trim()];

  for (const candidate of candidates) {
    if (candidate.startsWith('http://') || candidate.startsWith('https://')) {
      return fetchImageBuffer(candidate);
    }

    const customEmojiUrl = parseCustomEmoji(candidate);
    if (customEmojiUrl) {
      return fetchImageBuffer(customEmojiUrl);
    }

    const unicodeUrl = parseUnicodeEmoji(candidate);
    if (unicodeUrl) {
      return fetchImageBuffer(unicodeUrl);
    }
  }

  return null;
}

module.exports = {
  parseCustomEmoji,
  parseUnicodeEmoji,
  fetchImageBuffer,
  resolveIconBuffer
};
