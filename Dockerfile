FROM node:18-alpine

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
COPY package*.json ./
RUN npm ci --only=production

# Bundle app source
COPY . .

# Expose port (Railway will set PORT env variable)
EXPOSE 3000

# Start the application
CMD [ "node", "server.js" ]
