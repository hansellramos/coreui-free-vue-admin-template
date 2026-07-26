/**
 * Meta WhatsApp Cloud API Service
 *
 * Sends messages, downloads media, and marks messages as read
 * via the official Graph API v22.0.
 */

const GRAPH_API = 'https://graph.facebook.com/v22.0';

async function graphRequest(url, token, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...options.headers
    }
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Graph API ${res.status}: ${body}`);
  }
  return options.raw ? res : res.json();
}

/**
 * Send a text message.
 * @returns {{ messaging_product, contacts, messages }} — messages[0].id is the wamid
 */
async function sendText(phoneNumberId, token, to, text) {
  return graphRequest(`${GRAPH_API}/${phoneNumberId}/messages`, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: text }
    })
  });
}

/**
 * Send an image message with optional caption.
 */
async function sendImage(phoneNumberId, token, to, imageUrl, caption) {
  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'image',
    image: { link: imageUrl }
  };
  if (caption) payload.image.caption = caption;

  return graphRequest(`${GRAPH_API}/${phoneNumberId}/messages`, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

/**
 * Send a template message (e.g. hello_world for testing).
 */
async function sendTemplate(phoneNumberId, token, to, templateName, lang = 'en_US') {
  return graphRequest(`${GRAPH_API}/${phoneNumberId}/messages`, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: templateName,
        language: { code: lang }
      }
    })
  });
}

/**
 * Download media by its ID. Returns a Buffer.
 */
async function downloadMedia(mediaId, token) {
  // Step 1: get the media URL
  const meta = await graphRequest(`${GRAPH_API}/${mediaId}`, token);
  // Step 2: download the actual binary
  const res = await graphRequest(meta.url, token, { raw: true });
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Mark a message as read.
 */
async function markAsRead(phoneNumberId, token, messageId) {
  return graphRequest(`${GRAPH_API}/${phoneNumberId}/messages`, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: messageId
    })
  });
}

module.exports = { sendText, sendImage, sendTemplate, downloadMedia, markAsRead };
