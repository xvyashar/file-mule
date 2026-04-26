# File Mule
A lightweight bridge that carries your files from Telegram to Iranian social platforms like Bale and Rubika.

## Requirements
- Telegram API ID & API Hash
- Docker
- Node.js & NPM (for database migrations)
> [!INFO]
> You need an API ID and API Hash to run a local Bot API server and bypass Telegram’s 20 MB download limit. Get them here: https://core.telegram.org/api/obtaining_api_id

## Configurations
Configuration is split into two parts:
- General settings → `config.yaml`
- Secrets → `.env`

### config.yaml
```yaml
telegram:
  webhook:
    enabled: true
    port: 3000
    # endpoint: https://hook.example.com (in case that you're not in local mode)
  whitelist:
    - 'YOUR_ACCOUNT_NUMERIC_ID' # replace this list items with your whitelisted user numeric ids or remove this option to make this bot public
  botApi:
    localMode: true # using local bot api bypasses 20 MB telegram limit for file downloads
    baseUrl: http://telegram-bot-api:8081 # or replace it with https://api.telegram.org and turn off the local mode to use the official global api
limits:
  downloads: 500 # download size limit
  chunks: 20 # file chunks size to upload in ir-socials
  # or chunks:
  #      bale: 20
  #      rubika: 50
```
> [!INFO]
> Default values are suitable for most use cases. You’ll likely only need to adjust the whitelist or tweak limits. Other options are likely to get changed for development environment

### .env
```.env
TELEGRAM_API_ID=your_api_id
TELEGRAM_API_HASH=your_api_hash
TELEGRAM_BOT_TOKEN=your_bot_token
BALE_BOT_TOKEN=your_bale_token
RUBIKA_BOT_TOKEN=your_rubika_token
```

## Deployment
This project uses Drizzle ORM with SQLite for database management.
Before running the app, you must apply migrations.
```bash
mkdir data
npm install
npx drizzle-kit migrate
```
If migrate fails (because life is unpredictable), try:
```bash
npx drizzle-kit push
```
Yes, installing dependencies is required because `drizzle-kit` depends on `drizzle-orm`.

### Run the project
```bash
docker compose up -d
```
> [!INFO]
> The Docker setup uses the latest image tag by default. If you care about stability (you probably should), pin it to a specific version.