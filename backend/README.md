# Arena Room — Backend

Node.js + Fastify + TypeScript + PostgreSQL + Redis + Socket.io

## Быстрый старт

### 1. Установка
```bash
npm install
cp .env.example .env
```

### 2. Запустить базы через Docker
```bash
docker-compose up postgres redis -d
```

### 3. Применить миграции и заполнить данными
```bash
npm run db:migrate
npm run db:seed
```

### 4. Запустить сервер
```bash
npm run dev
# Server: http://localhost:4000
```

### Или всё через Docker
```bash
docker-compose up --build
```

---

## API Endpoints

### Auth
| Method | URL | Описание |
|--------|-----|----------|
| POST | `/api/auth/register` | Регистрация |
| POST | `/api/auth/login` | Логин |
| GET | `/api/auth/me` | Текущий пользователь |

### Users
| Method | URL | Описание |
|--------|-----|----------|
| GET | `/api/users/leaderboard` | Топ игроков |
| GET | `/api/users/:id` | Профиль |
| PATCH | `/api/users/me` | Обновить профиль |

### Matchmaking
| Method | URL | Описание |
|--------|-----|----------|
| POST | `/api/matchmaking/join` | Войти в очередь |
| POST | `/api/matchmaking/leave` | Покинуть очередь |
| GET | `/api/matchmaking/position` | Позиция в очереди |

### Matches
| Method | URL | Описание |
|--------|-----|----------|
| GET | `/api/matches` | Список матчей |
| GET | `/api/matches/:id` | Детали матча |
| POST | `/api/matches/:id/veto` | Забанить карту (капитан) |
| POST | `/api/matches/:id/result` | Записать результат |

### Tournaments
| Method | URL | Описание |
|--------|-----|----------|
| GET | `/api/tournaments` | Все турниры |
| GET | `/api/tournaments/:id` | Детали |
| POST | `/api/tournaments` | Создать турнир |
| POST | `/api/tournaments/:id/register` | Зарегистрироваться |
| DELETE | `/api/tournaments/:id/register` | Отмена регистрации |

### Missions
| Method | URL | Описание |
|--------|-----|----------|
| GET | `/api/missions` | Активные миссии + прогресс |
| POST | `/api/missions/:id/claim` | Забрать награду |

---

## Socket.io Events

### Client → Server
```js
socket.emit('match:join', matchId)       // войти в лобби
socket.emit('match:ready', matchId)      // подтвердить готовность
socket.emit('match:chat', { matchId, message })  // чат
socket.emit('queue:ping', { mode })      // проверить очередь
```

### Server → Client
```js
socket.on('match:found', ({ matchId, mode, map, players }) => {})
socket.on('match:veto', ({ banned, by, remaining }) => {})
socket.on('match:started', ({ map }) => {})
socket.on('match:ended', ({ winningSide, teamAScore, teamBScore }) => {})
socket.on('match:chat', ({ userId, username, message, time }) => {})
socket.on('queue:update', ({ queueSize, mode }) => {})
```

---

## ELO Formula
- Base K-factor: 30 (5v5), 20 (2v2)
- Expected score: `1 / (1 + 10^((oppElo - myElo) / 400))`
- ELO floor: 100
- Teams balanced by ELO average, snake-draft assignment
