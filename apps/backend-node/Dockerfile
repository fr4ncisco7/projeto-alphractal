FROM node:20-alpine

WORKDIR /app

# O lockfile entra junto e a instalação é `npm ci`, não `npm install`: `ci`
# instala exatamente as versões travadas e falha se o lock divergir do
# package.json. Mesma motivação do pin de versões no requirements.txt do solver.
COPY package.json package-lock.json ./
RUN npm ci

COPY src ./src
COPY tsconfig.json ./

EXPOSE 3000

CMD ["npm", "run", "dev"]
