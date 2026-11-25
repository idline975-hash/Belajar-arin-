import express from 'express';
import { fileURLToPath } from 'url';
import path from 'path';
import { GoogleGenAI, Type, ThinkingLevel } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

async function startServer() {
  const app = express();
  app.use(express.json());

  // API endpoint for generating questions
  app.post('/api/generate-questions', async (req, res) => {
    try {
      const { jenjang, kelas, mapel, topik, tipeSoal, jumlahSoal, levelKesulitan, distribusi } = req.body;

      if (!process.env.GEMINI_API_KEY) {
        return res.status(500).json({
          error: 'GEMINI_API_KEY belum dikonfigurasi. Silakan periksa panel Settings > Secrets.',
        });
      }

      const count = Math.min(20, Math.max(1, Number(jumlahSoal) || 5));
      const jenisSoal = tipeSoal || 'Pilihan Ganda';
      const userPrompt = `Buatkan ${count} soal tipe "${jenisSoal}" tentang materi "${topik}" untuk mata pelajaran "${mapel || ''}" tingkat "${jenjang}" (${kelas || ''}).
Tingkat Kesulitan: ${levelKesulitan || 'Level 2: Sedang (Aplikasi)'}.
Distribusi Soal: ${distribusi || 'Proporsional (Normal)'}.
${jenisSoal === 'Pilihan Ganda' ? 'Setiap soal WAJIB memiliki 4 opsi jawaban (A, B, C, D) dalam array "opsi", dan "kunci" harus sama persis dengan salah satu opsi tersebut.' : 'Untuk tipe soal Isian Singkat atau Uraian / Essay, kosongkan array "opsi" ([]), dan tuliskan jawaban yang diharapkan pada "kunci".'}`;

      const systemInstruction =
        'Anda adalah pembuat soal profesional yang menyusun soal ujian berkualitas tinggi sesuai kurikulum nasional Indonesia. Selalu berikan pertanyaan yang akurat, relevan dengan jenjang dan materi, serta pembahasan yang jelas dan rinci.';

      const responseSchema = {
        type: Type.OBJECT,
        properties: {
          soal: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.INTEGER },
                pertanyaan: { type: Type.STRING },
                opsi: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
                kunci: { type: Type.STRING },
                pembahasan: { type: Type.STRING },
              },
              required: ['id', 'pertanyaan', 'opsi', 'kunci', 'pembahasan'],
            },
          },
        },
        required: ['soal'],
      };

      const candidateModels = ['gemini-3.1-flash-lite', 'gemini-4-hydrogen', 'gemini-3.8-flash'];

      let response: any = null;
      let lastError: any = null;
      const totalDeadline = Date.now() + 25000;

      for (let i = 0; i < candidateModels.length; i++) {
        const modelName = candidateModels[i];
        const remainingMs = totalDeadline - Date.now();
        if (remainingMs <= 2000) break;

        const timeoutMs = i === 0 ? Math.min(15000, remainingMs) : remainingMs;

        try {
          const config: Record<string, any> = {
            systemInstruction,
            responseMimeType: 'application/json',
            responseSchema,
            abortSignal: AbortSignal.timeout(timeoutMs),
          };
          if (modelName === 'gemini-4-hydrogen') {
            config.thinkingConfig = { thinkingLevel: ThinkingLevel.LOW };
          }
          response = await ai.models.generateContent({
            model: modelName,
            contents: userPrompt,
            config,
          });
          if (response?.text) {
            break;
          }
        } catch (err: any) {
          lastError = err;
        }
      }

      if (!response) {
        throw lastError || new Error('Layanan AI sedang sibuk. Silakan coba lagi beberapa saat lagi.');
      }

      const responseText = (response.text ?? '').trim();
      if (!responseText) {
        return res.status(502).json({
          error: 'Model AI mengembalikan respons kosong. Silakan coba lagi.',
        });
      }

      let cleanJson = responseText;
      if (cleanJson.startsWith('```json')) {
        cleanJson = cleanJson.replace(/^```json\s*/, '').replace(/\s*```$/, '');
      } else if (cleanJson.startsWith('```')) {
        cleanJson = cleanJson.replace(/^```\s*/, '').replace(/\s*```$/, '');
      }

      const parsed = JSON.parse(cleanJson);
      const soalList = Array.isArray(parsed) ? parsed : parsed?.soal;

      if (!Array.isArray(soalList) || soalList.length === 0) {
        return res.status(502).json({
          error: 'Format soal dari AI tidak valid. Silakan coba buat soal kembali.',
        });
      }

      return res.json({ soal: soalList });
    } catch (error: any) {
      const status = typeof error?.status === 'number' ? error.status : 503;
      let friendlyMessage = 'Layanan AI sedang mengalami lonjakan trafik sementara. Silakan tunggu sebentar lalu klik Buat Soal lagi.';
      if (status === 429) {
        friendlyMessage = 'Batas kuota permintaan AI (Free Tier) sementara tercapai. Anda dapat mencoba lagi nanti atau menggunakan API key berbayar di panel Settings > Secrets.';
      } else if (status === 400 || status === 401 || status === 403) {
        friendlyMessage = 'Konfigurasi kunci API AI bermasalah. Silakan periksa panel Settings > Secrets.';
      } else if (error?.name === 'AbortError' || error?.name === 'TimeoutError' || String(error?.message).includes('aborted')) {
        friendlyMessage = 'Layanan AI sedang lambat merespons. Silakan coba kurangi jumlah soal atau klik Buat Soal lagi.';
      }
      return res.status(status === 200 ? 500 : status).json({
        error: friendlyMessage,
      });
    }
  });

  // Setup Vite in development or static serving in production
  const isProduction = process.env.NODE_ENV === 'production';
  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  const PORT = Number(process.env.PORT) || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
