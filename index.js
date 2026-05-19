const { 
  Client,
  GatewayIntentBits,
  Events,
  ActivityType
} = require('discord.js');

require('dotenv').config();

const fetch = globalThis.fetch || require('node-fetch');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
});

const conversationHistory = new Map();

const MAX_HISTORY = 10;
const MAX_MESSAGE_LENGTH = 3072;

async function callFlollamaAPI(messages) {
  try {
    const response = await fetch('https://flollama.in/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'FlollamaDiscordBot/2.0'
      },
      body: JSON.stringify({ messages })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    let result = '';

    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      result += decoder.decode(value, { stream: true });
    }

    return result.trim();

  } catch (error) {
    console.error('Flollama API Error:', error);
    throw error;
  }
}

function getHistory(channelId) {
  if (!conversationHistory.has(channelId)) {
    conversationHistory.set(channelId, []);
  }

  return conversationHistory.get(channelId);
}

function addToHistory(channelId, role, content) {
  const history = getHistory(channelId);

  history.push({ role, content });

  if (history.length > MAX_HISTORY) {
    history.splice(0, history.length - MAX_HISTORY);
  }
}

function splitMessage(text) {
  if (text.length <= MAX_MESSAGE_LENGTH) {
    return [text];
  }

  const chunks = [];

  for (let i = 0; i < text.length; i += MAX_MESSAGE_LENGTH) {
    chunks.push(text.slice(i, i + MAX_MESSAGE_LENGTH));
  }

  return chunks;
}

client.once(Events.ClientReady, readyClient => {
  console.log(`Logged in as ${readyClient.user.tag}`);

  client.user.setActivity('flollama.in', {
    type: ActivityType.Watching
  });

  console.log(`Serving ${client.guilds.cache.size} servers`);

  console.log('Servers List:');

  client.guilds.cache.forEach(guild => {
    console.log(`- ${guild.name} (${guild.id})`);
  });
});

client.on(Events.MessageCreate, async message => {
  if (message.author.bot) return;

  const isMentioned = message.mentions.has(client.user);

  let isReplyToBot = false;

  if (message.reference?.messageId) {
    const referencedMessage = await message.channel.messages
      .fetch(message.reference.messageId)
      .catch(() => null);

    isReplyToBot = referencedMessage?.author?.id === client.user.id;
  }

  if (!isMentioned && !isReplyToBot) return;

  let content = message.content
    .replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '')
    .trim();

  if (!content) {
    return message.reply('yeah?');
  }

  if (
    content.toLowerCase() === 'clear' ||
    content.toLowerCase() === 'reset'
  ) {
    conversationHistory.delete(message.channel.id);

    return message.reply('memory wiped');
  }

  const typing = setInterval(() => {
    message.channel.sendTyping();
  }, 4000);

  try {
    addToHistory(
      message.channel.id,
      'user',
      `${message.author.username}: ${content}`
    );

    const response = await callFlollamaAPI(
      getHistory(message.channel.id)
    );

    if (!response) {
      throw new Error('Empty response');
    }

    addToHistory(
      message.channel.id,
      'assistant',
      response
    );

    const chunks = splitMessage(response);

    for (let i = 0; i < chunks.length; i++) {
      if (i === 0) {
        await message.reply(chunks[i]);
      } else {
        await message.channel.send(chunks[i]);
      }
    }

  } catch (error) {
    console.error('Message Error:', error);

    let errorMessage = 'something broke';

    if (error.message.includes('HTTP')) {
      errorMessage = 'api cooked itself. try again later';
    }

    await message.reply(errorMessage);

  } finally {
    clearInterval(typing);
  }
});

client.on('error', error => {
  console.error('Discord Error:', error);
});

process.on('SIGINT', () => {
  client.destroy();
  process.exit(0);
});

process.on('SIGTERM', () => {
  client.destroy();
  process.exit(0);
});

if (!process.env.DISCORD_TOKEN) {
  console.error('Missing DISCORD_TOKEN');
  process.exit(1);
}

client.login(process.env.DISCORD_TOKEN).catch(error => {
  console.error('Login Failed:', error);
  process.exit(1);
});

