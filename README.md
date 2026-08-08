# MIM AI — Customer Support Assistant Demo

Architecture: Browser chat UI → secure `/api/chat` backend proxy → n8n production webhook → AI routing → response.

## Run locally
1. Install Node.js 18+.
2. Open terminal in this folder and run `npm install`.
3. Copy `.env.example` to `.env`.
4. Put your production n8n webhook URL and private X-API-Key secret into `.env`.
5. Run `npm start`.
6. Open `http://localhost:3000`.

Never expose the `.env` file or the X-API-Key in browser JavaScript, screenshots, or public repositories.
