# Use an official Node.js runtime as a parent image
FROM node:20-slim

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json to the working directory
COPY package*.json ./

# Install any needed packages
RUN npm install

# Bundle app source
COPY . .

# Build the typescript code
RUN npm run build --if-present

# Make port 3000 available to the world outside this container
EXPOSE 3000

# Define the command to run the app
CMD [ "npm", "start" ]
