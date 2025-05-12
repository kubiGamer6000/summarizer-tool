# Chat Summarizer

A Node.js tool that summarizes daily chats from Firestore using OpenAI's GPT model.

## Features

- Fetches all messages from Firestore for the current day
- Groups messages by chat ID
- Generates summaries for each chat using OpenAI's GPT-3.5
- Handles Firebase Admin SDK authentication
- Environment variable configuration

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create a `.env` file based on `.env.example` and fill in your credentials:

- Firebase Admin SDK credentials (project ID, private key, client email)
- OpenAI API key

3. Make sure your Firestore database has a `messages` collection with the following schema:

- `chatId`: string (the ID of the chat)
- `sender`: string (the sender of the message)
- `content`: string (the message content)
- `timestamp`: timestamp (when the message was sent)

## Usage

Run the script:

```bash
npm start
```

The script will:

1. Fetch all messages from today
2. Group them by chat ID
3. Generate a summary for each chat
4. Output the summaries to the console

## Error Handling

The script includes error handling for:

- Firebase connection issues
- OpenAI API errors
- Invalid message formats

## Environment Variables

- `FIREBASE_PROJECT_ID`: Your Firebase project ID
- `FIREBASE_PRIVATE_KEY`: Your Firebase private key
- `FIREBASE_CLIENT_EMAIL`: Your Firebase client email
- `OPENAI_API_KEY`: Your OpenAI API key
