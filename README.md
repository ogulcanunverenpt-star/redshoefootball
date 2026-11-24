# Node Passport Login

A simple Node.js authentication starter built with Express, Passport, MongoDB, Mongoose, EJS, and Bootstrap.

This project demonstrates:

- Local authentication with Passport
- User registration and login
- Password hashing with bcryptjs
- Protected dashboard route
- Flash messages for validation and auth feedback
- EJS views with a Bootstrap-powered UI

## Version

2.0.0

## Requirements

- Node.js 22 or newer recommended
- npm
- MongoDB Atlas or a local MongoDB database

## Installation

```sh
npm install
```

## MongoDB Setup

Open `config/keys.js` and replace the placeholder MongoDB URI with your own local or Atlas connection string.

Example local URI:

```js
const dbPassword = 'mongodb://127.0.0.1:27017/node_passport_login';

module.exports = {
  mongoURI: dbPassword
};
```

For MongoDB Atlas, use the connection string from your Atlas dashboard and make sure your database username, password, and network access settings are correct.

> Do not commit real database credentials to GitHub.

## Running the App

```sh
npm start
```

For development with automatic restarts:

```sh
npm run dev
```

### Multiplayer deployment

The game, chat, rooms, and PeerJS signaling use in-memory state and require a
single persistent Node.js server. Deploy this repository as one Railway
instance (the included `railway.json` starts `node app.js`), and point the
game domain directly to that service. The server listens on `PORT`, or 4000
locally. Ensure the proxy permits WebSocket upgrades and long polling. Multiple
instances require shared game state and Socket.IO coordination; sticky sessions
alone do not synchronize the game. SQLite data also needs persistent storage.

Vercel Function instances have bounded lifetimes and independent memory, so
the current game engine cannot reliably run there without a shared-state
redesign. Deploying a new build or changing DNS does not migrate live state.

Then visit:

```text
http://localhost:4000
```

## Routes

- `GET /` - welcome page
- `GET /users/register` - register page
- `POST /users/register` - create a user
- `GET /users/login` - login page
- `POST /users/login` - authenticate a user
- `GET /dashboard` - protected dashboard
- `GET /users/logout` - logout

## Scripts

```sh
npm start
npm run dev
```

## Dependencies

This project uses current major versions of the main packages, including Express 5, EJS 5, Mongoose 9, Passport 0.7, and Bootstrap 5.
