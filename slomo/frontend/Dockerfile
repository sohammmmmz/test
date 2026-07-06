FROM node:20-alpine AS build
WORKDIR /srv/slomo
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /srv/slomo
ENV NODE_ENV=production
COPY --from=build /srv/slomo/.next ./.next
COPY --from=build /srv/slomo/node_modules ./node_modules
COPY --from=build /srv/slomo/package.json ./package.json
COPY --from=build /srv/slomo/public ./public
EXPOSE 3000
CMD ["npm", "start"]
