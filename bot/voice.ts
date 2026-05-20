import OpenAI, { toFile } from "openai";

export async function transcribeBuffer(
  audio: Buffer,
  filename: string,
  openai: OpenAI,
): Promise<string> {
  const file = await toFile(audio, filename);
  const res = await openai.audio.transcriptions.create({
    model: "whisper-1",
    language: "ru",
    file,
  });
  return res.text.trim();
}

export async function downloadTelegramVoice(
  fileId: string,
  botToken: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ buffer: Buffer; filename: string }> {
  const metaRes = await fetchFn(
    `https://api.telegram.org/bot${botToken}/getFile?file_id=${encodeURIComponent(fileId)}`,
  );
  const meta = (await metaRes.json()) as {
    ok: boolean;
    result?: { file_path: string };
  };
  if (!meta.ok || !meta.result) {
    throw new Error(`Telegram getFile failed for ${fileId}`);
  }
  const filePath = meta.result.file_path;
  const fileRes = await fetchFn(
    `https://api.telegram.org/file/bot${botToken}/${filePath}`,
  );
  if (!fileRes.ok) {
    throw new Error(`Telegram file download failed (${fileRes.status})`);
  }
  const ab = await fileRes.arrayBuffer();
  const filename = filePath.split("/").pop() ?? "voice.ogg";
  return { buffer: Buffer.from(ab), filename };
}
