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

function extractFirstEmoji(input) {
  if (!input) return null;
  const match = input.match(/(\p{Extended_Pictographic}|\p{Emoji_Presentation}|\p{Emoji}\uFE0F)/u);
  return match ? match[0] : null;
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

  const trimmedInput = input.trim();
  const tokens = trimmedInput.split(/\s+/).filter(Boolean);

  for (const token of tokens) {
    if (token.startsWith('http://') || token.startsWith('https://')) {
      return fetchImageBuffer(token);
    }
  }

  const customMatch = trimmedInput.match(/<(a?):\w+:(\d+)>/);
  if (customMatch) {
    const customEmojiUrl = parseCustomEmoji(customMatch[0]);
    if (customEmojiUrl) {
      return fetchImageBuffer(customEmojiUrl);
    }
  }

  const emojiToken = extractFirstEmoji(trimmedInput);
  if (emojiToken) {
    const unicodeUrl = parseUnicodeEmoji(emojiToken);
    if (unicodeUrl) {
      return fetchImageBuffer(unicodeUrl);
    }
  }

  return null;
}

module.exports = {
  parseCustomEmoji,
  parseUnicodeEmoji,
  extractFirstEmoji,
  fetchImageBuffer,
  resolveIconBuffer
};
