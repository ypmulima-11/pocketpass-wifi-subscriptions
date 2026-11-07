FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY server ./server
COPY index.html styles.css app.js portal.html portal.css portal.js ./
EXPOSE 3000
CMD ["npm", "start"]
