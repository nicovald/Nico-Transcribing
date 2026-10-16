// Hands the browser a short-lived token to upload one video straight into private Blob storage.
// Only signed-in team members reach this (Vercel Authentication), and only the uploads/ folder is allowed.
import { handleUpload } from '@vercel/blob/client';
import { UPLOAD_PREFIX } from '../server/cloud.js';

async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

export default async function handler(req, res) {
  res.setHeader('content-type', 'application/json');
  try {
    if (req.method !== 'POST') throw Object.assign(new Error('Method not allowed'), { status: 405 });
    const result = await handleUpload({
      request: req,
      body: await readJson(req),
      onBeforeGenerateToken: async (pathname) => {
        if (!pathname.startsWith(UPLOAD_PREFIX) || pathname.includes('..')) throw new Error('Uploads must go to the uploads folder.');
        return { allowedContentTypes: ['video/*', 'audio/*', 'application/octet-stream'], maximumSizeInBytes: 200 * 1024 ** 3, addRandomSuffix: false };
      },
    });
    res.end(JSON.stringify(result));
  } catch (err) {
    res.statusCode = err.status || 400;
    res.end(JSON.stringify({ error: err.message }));
  }
}
