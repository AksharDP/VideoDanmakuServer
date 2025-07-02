# Video Danmaku Server

A Bun-powered API server for managing videos and danmaku (bullet comments) using Hono framework and Drizzle ORM with PostgreSQL.

## Setup

### Prerequisites

- [Bun](https://bun.sh/) runtime (What was used for development)
- PostgreSQL database

### Installation

1. Install dependencies:
```sh
bun install
```

2. Set the DATABASE_URL environment variable in your system:

**Windows (PowerShell):**
```powershell
$env:DATABASE_URL = "postgres://username:password@localhost:5432/your_database"
```

**Windows (Command Prompt):**
```cmd
set DATABASE_URL=postgres://username:password@localhost:5432/your_database
```

**Linux/macOS:**
```bash
export DATABASE_URL="postgres://username:password@localhost:5432/your_database"
```

> **Note:** For persistent environment variables, you may want to add the export command to your shell profile (`.bashrc`, `.zshrc`, etc.) or use your system's environment variable settings.

3. Generate and run database migrations:
```sh
bun run db:generate
bun run db:push
```

### Development

To run in development mode with hot reload:
```sh
bun run dev
```

To run in development mode on a specific port:
```sh
bun run dev --port 8080
# or
bun run dev -P 8080
```

### Production

To run the server in production mode:
```sh
bun run start
```

To run the server in production mode on a specific port:
```sh
bun run start --port 8080
# or
bun run start -P 8080
```

You can also set the port using an environment variable:
```sh
PORT=8080 bun run start
```

## Docker Deployment

### Prerequisites for Docker

You need access to a PostgreSQL database. The Docker container will connect to an external PostgreSQL server using the connection URL you provide.

### Using Docker
```

1. **Build the Docker image:**
```sh
docker build -t video-danmaku-server .
```

2. **Run with default port (3000):**
```sh
docker run -d \
  --name danmaku-server \
  -p 3000:3000 \
  -e DATABASE_URL="postgres://myuser:mypass@192.168.1.100:5432/danmaku_db" \
  -e NODE_ENV=production \
  video-danmaku-server
```

3. **Run with custom port (8080):**
```sh
docker run -d \
  --name danmaku-server \
  -p 8080:8080 \
  -e DATABASE_URL="postgres://myuser:mypass@192.168.1.100:5432/danmaku_db" \
  -e NODE_ENV=production \
  -e PORT=8080 \
  video-danmaku-server
```

4. **Run with cloud database (example with AWS RDS):**
```sh
docker run -d \
  --name danmaku-server \
  -p 5000:5000 \
  -e DATABASE_URL="postgres://admin:secret123@mydb.xyz.rds.amazonaws.com:5432/production_db" \
  -e NODE_ENV=production \
  -e PORT=5000 \
  video-danmaku-server
```

### Environment Variables for Docker

- `DATABASE_URL`: PostgreSQL connection string (required)
- `NODE_ENV`: Set to `production` for production mode
- `PORT`: Port number (default: 3000)

## API Endpoints

### General
- `GET /` - Server status check.
  - **Response Body (Text):**
  ```
  VideoDanmakuServer is running!
  ```

- `GET /ping` - Returns a JSON object with the server status and current timestamp of when server received the request.
  - **Response Body (JSON):**
  ```json
  {
    "status": "ok",
    "timestamp": "2023-10-27T10:00:00.000Z"
  }
  ```

### Comments (Danmaku)
- `GET /getComments` - Get all comments for a video.
  - **Query Parameters:** `platform`, `videoId`
  - **Example:** `GET /getComments?platform=youtube&videoId=video_id`
  - **Response Body (JSON) - Success:**
  ```json
  {
    "success": true,
    "comments": [
      {
        "id": 1,
        "content": "This is a danmaku comment!",
        "time": 123,
        "userId": 1,
        "videoId": 1,
        "scrollMode": "slide",
        "color": "#ffffff",
        "fontSize": "normal",
        "createdAt": "2023-10-27T10:00:00.000Z"
      },
      {
        "id": 2,
        "content": "Great scene!",
        "time": 87,
        "userId": 2,
        "videoId": 1,
        "scrollMode": "top",
        "color": "#ff0000",
        "fontSize": "large",
        "createdAt": "2023-10-27T10:05:00.000Z"
      },
      {
        "id": 3,
        "content": "LOL",
        "time": 156,
        "userId": 3,
        "videoId": 1,
        "scrollMode": "bottom",
        "color": "#00ff00",
        "fontSize": "small",
        "createdAt": "2023-10-27T10:10:00.000Z"
      }
    ]
  }
  ```
  - **Response Body (JSON) - Error (400):**
  ```json
  {
    "success": false,
    "error": "Missing platform or videoId query parameters"
  }
  ```
  - **Response Body (JSON) - Error (500):**
  ```json
  {
    "success": false,
    "error": "Failed to fetch comments"
  }
  ```

- `POST /addComment` - Add a new comment to a video.
  - **Request Body (JSON):**
  ```json
  {
    "platform": "youtube",
    "videoId": "video_id",
    "time": 123,
    "text": "This is a danmaku comment!",
    "username": "user123",
    "color": "#ffffff",
    "scrollMode": "slide",
    "fontSize": "normal"
  }
  ```
  - **Response Body (JSON) - Success:**
  ```json
  {
    "success": true,
    "comment": {
      "id": 1,
      "content": "This is a danmaku comment!",
      "time": 123,
      "userId": 1,
      "videoId": 1,
      "scrollMode": "slide",
      "color": "#ffffff",
      "fontSize": "normal",
      "createdAt": "2023-10-27T10:00:00.000Z"
    }
  }
  ```
  - **Response Body (JSON) - Error (400):**
  ```json
  {
    "success": false,
    "error": "Missing required fields: platform, videoId, time, text, username"
  }
  ```
  - **Response Body (JSON) - Error (500):**
  ```json
  {
    "success": false,
    "error": "Failed to add comment"
  }
  ```
  - **Fields:**
    - `platform` (string, required)
    - `videoId` (string, required)
    - `time` (number, required): Video timestamp in seconds.
    - `text` (string, required)
    - `username` (string, required)
    - `color` (string, optional, default: `#ffffff`)
    - `scrollMode` (string, optional, enum: `slide`, `top`, `bottom`, default: `slide`)
    - `fontSize` (string, optional, enum: `small`, `normal`, `large`, default: `normal`)

## Database Schema

The schema is defined using Drizzle ORM.

### `users` Table
- `id`: Serial primary key
- `platform`: The platform the user belongs to (e.g., "youtube").
- `username`: The user's name on the platform.
- `createdAt`: Timestamp of creation.

### `videos` Table
- `id`: Serial primary key
- `platform`: The video platform (e.g., "youtube", "crunchyroll").
- `videoId`: The unique identifier for the video on its platform.

### `comments` Table
- `id`: Serial primary key
- `content`: The text of the comment.
- `time`: Video timestamp in seconds when the comment appears.
- `userId`: Foreign key to the `users` table.
- `videoId`: Foreign key to the `videos` table.
- `scrollMode`: How the comment moves on screen (`slide`, `top`, `bottom`).
- `color`: Hex color code for the comment text.
- `fontSize`: Font size of the comment (`small`, `normal`, `large`).
- `createdAt`: Timestamp of creation.
