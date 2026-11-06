FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json server.mjs file-model.js password-hash.js ./
COPY index.html explorer-view.html app.js landing.js download-center.json landing.css explorer.css aegipulse.css shefiles-icon.svg sw.js ./
COPY protected-rules.json explorer-config.json wiki-config.json ereader-config.json ereader-manifest.json /config/
EXPOSE 3000
CMD ["node", "server.mjs"]
