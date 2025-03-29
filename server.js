const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const winston = require('winston');
const sanitizeHtml = require('sanitize-html');
const fs = require('fs');
const path = require('path');
const app = express();
const port = process.env.PORT || 3000;

// プロキシを信頼する設定（Render 環境用）
app.set('trust proxy', 1);

// ログディレクトリの作成
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir);
}

// ロガーの設定
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
    new winston.transports.Console()
  ]
});

// ミドルウェア
app.use(express.json());
app.use(express.static('public'));

// レートリミティング（1分間に10リクエストまで）
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1分
  max: 10,
  message: 'リクエストが多すぎます。しばらく待ってから再度お試しください。'
});
app.use('/login', limiter);
app.use('/register', limiter);

// ダミーデータ（実際はデータベースを使用する想定）
let users = [
  {
    username: 'Hal',
    password: '$2a$10$z5g7YxW0f0z5g7YxW0f0z5g7YxW0f0z5g7YxW0f0z5g7YxW0f0z5g7YxW0f0', // hayato0429
    isAdmin: true,
    following: [],
    followers: [],
    bio: '管理者アカウントです。',
    profileImage: '',
    verified: true,
    createdAt: new Date().toISOString()
  }
];
let tweets = [];
let notifications = [];
let activityLog = [];

// 入力バリデーション
function validateInput(input) {
  const regex = /^[a-zA-Z0-9_@.-]+$/;
  return regex.test(input);
}

// JWT認証ミドルウェア
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    logger.warn('認証失敗: トークンがありません。');
    return res.status(401).json({ error: 'トークンが必要です。' });
  }

  jwt.verify(token, 'secret_key', (err, user) => {
    if (err) {
      logger.warn('認証失敗: トークンが無効です。');
      return res.status(403).json({ error: 'トークンが無効です。' });
    }
    req.user = user;
    next();
  });
}

// 新規登録
app.post('/register', async (req, res) => {
  const { username, password } = req.body;

  if (!validateInput(username) || !validateInput(password)) {
    logger.warn('新規登録: 無効な入力', { username });
    return res.status(400).json({ error: 'ユーザー名またはパスワードが無効です。英数字と一部の記号（_@.-）のみ使用可能です。' });
  }

  try {
    const existingUser = users.find(u => u.username === username);
    if (existingUser) {
      logger.warn(`新規登録失敗: ユーザー名 ${username} は既に存在します。`);
      return res.status(400).json({ error: 'ユーザー名がすでに存在します。' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = {
      username,
      password: hashedPassword,
      isAdmin: false,
      following: [],
      followers: [],
      bio: '',
      profileImage: '',
      verified: false,
      createdAt: new Date().toISOString()
    };

    users.push(newUser);
    activityLog.push({
      username,
      action: '新規登録',
      timestamp: new Date().toISOString()
    });

    logger.info(`新規登録成功: ユーザー=${username}`);
    logger.debug(`現在のユーザー一覧: ${JSON.stringify(users)}`); // デバッグ用ログ
    res.status(201).json({ message: '登録成功！' });
  } catch (error) {
    logger.error('新規登録エラー:', error);
    res.status(500).json({ error: 'サーバーエラーが発生しました。' });
  }
});

// ログイン
app.post('/login', async (req, res) => {
  const { username, password } = req.body;

  const user = users.find(u => u.username === username);
  if (!user) {
    logger.warn(`ログイン失敗: ユーザー名 ${username} が見つかりません。`);
    return res.status(400).json({ error: 'ユーザー名が見つかりません。' });
  }

  try {
    if (await bcrypt.compare(password, user.password)) {
      const token = jwt.sign(
        { username: user.username, isAdmin: user.isAdmin },
        'secret_key',
        { expiresIn: '1h' }
      );
      logger.info(`ログイン成功: ユーザー=${username}, トークン=${token}`);
      res.json({ token });
    } else {
      logger.warn(`ログイン失敗: パスワードが間違っています。ユーザー=${username}`);
      res.status(400).json({ error: 'パスワードが間違っています。' });
    }
  } catch (error) {
    logger.error('ログインエラー:', error);
    res.status(500).json({ error: 'サーバーエラーが発生しました。' });
  }
});

// タイムライン（フォロー中）
app.get('/timeline/following', authenticateToken, (req, res) => {
  const currentUser = req.user.username;
  const user = users.find(u => u.username === currentUser);

  const followingTweets = tweets
    .filter(t => user.following.includes(t.username) || t.username === currentUser)
    .sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return new Date(b.timestamp) - new Date(a.timestamp);
    });

  logger.info(`フォロー中タイムライン取得: ユーザー=${currentUser}`);
  res.json({ tweets: followingTweets });
});

// おすすめタイムライン
app.get('/timeline/recommended', authenticateToken, (req, res) => {
  const recommendedTweets = tweets
    .sort((a, b) => {
      const aScore = a.likes.length + a.retweets.length;
      const bScore = b.likes.length + b.retweets.length;
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return bScore - aScore || new Date(b.timestamp) - new Date(a.timestamp);
    })
    .slice(0, 50);

  logger.info(`おすすめタイムライン取得: ユーザー=${req.user.username}`);
  res.json({ tweets: recommendedTweets });
});

// ツイート投稿
app.post('/tweets', authenticateToken, (req, res) => {
  const { content } = req.body;
  const cleanContent = sanitizeHtml(content, {
    allowedTags: [],
    allowedAttributes: {}
  });

  if (!cleanContent || cleanContent.length > 280) {
    logger.warn(`ツイート投稿失敗: 無効な内容。ユーザー=${req.user.username}`);
    return res.status(400).json({ error: 'ツイートは1～280文字で入力してください。' });
  }

  const tweet = {
    id: tweets.length + 1,
    username: req.user.username,
    content: cleanContent,
    timestamp: new Date().toISOString(),
    likes: [],
    retweets: [],
    replies: [],
    pinned: false
  };

  tweets.push(tweet);
  activityLog.push({
    username: req.user.username,
    action: 'ツイート投稿',
    timestamp: new Date().toISOString()
  });

  users.forEach(user => {
    if (user.followers.includes(req.user.username) && user.username !== req.user.username) {
      notifications.push({
        username: user.username,
        message: `${req.user.username} が新しいツイートを投稿しました: ${cleanContent.substring(0, 50)}...`,
        timestamp: new Date().toISOString(),
        read: false
      });
    }
  });

  logger.info(`ツイート投稿成功: ユーザー=${req.user.username}, 内容=${cleanContent}`);
  res.status(201).json(tweet);
});

// いいね
app.post('/tweets/:id/like', authenticateToken, (req, res) => {
  const tweetId = parseInt(req.params.id);
  const tweet = tweets.find(t => t.id === tweetId);

  if (!tweet) {
    logger.warn(`いいね失敗: ツイートが見つかりません。ID=${tweetId}`);
    return res.status(404).json({ error: 'ツイートが見つかりません。' });
  }

  if (tweet.likes.includes(req.user.username)) {
    tweet.likes = tweet.likes.filter(u => u !== req.user.username);
  } else {
    tweet.likes.push(req.user.username);
    if (tweet.username !== req.user.username) {
      notifications.push({
        username: tweet.username,
        message: `${req.user.username} があなたのツイートにいいねしました。`,
        timestamp: new Date().toISOString(),
        read: false
      });
    }
  }

  logger.info(`いいね成功: ユーザー=${req.user.username}, ツイートID=${tweetId}`);
  res.json({ likes_count: tweet.likes.length });
});

// リツイート
app.post('/tweets/:id/retweet', authenticateToken, (req, res) => {
  const tweetId = parseInt(req.params.id);
  const tweet = tweets.find(t => t.id === tweetId);

  if (!tweet) {
    logger.warn(`リツイート失敗: ツイートが見つかりません。ID=${tweetId}`);
    return res.status(404).json({ error: 'ツイートが見つかりません。' });
  }

  if (tweet.retweets.includes(req.user.username)) {
    logger.warn(`リツイート失敗: すでにリツイート済み。ユーザー=${req.user.username}, ツイートID=${tweetId}`);
    return res.status(400).json({ error: 'すでにリツイート済みです。' });
  }

  tweet.retweets.push(req.user.username);
  const retweet = {
    id: tweets.length + 1,
    username: req.user.username,
    content: `RT @${tweet.username}: ${tweet.content}`,
    timestamp: new Date().toISOString(),
    likes: [],
    retweets: [],
    replies: [],
    pinned: false
  };

  tweets.push(retweet);
  if (tweet.username !== req.user.username) {
    notifications.push({
      username: tweet.username,
      message: `${req.user.username} があなたのツイートをリツイートしました。`,
      timestamp: new Date().toISOString(),
      read: false
    });
  }

  logger.info(`リツイート成功: ユーザー=${req.user.username}, ツイートID=${tweetId}`);
  res.status(201).json(retweet);
});

// 返信
app.post('/tweets/:id/reply', authenticateToken, (req, res) => {
  const tweetId = parseInt(req.params.id);
  const tweet = tweets.find(t => t.id === tweetId);

  if (!tweet) {
    logger.warn(`返信失敗: ツイートが見つかりません。ID=${tweetId}`);
    return res.status(404).json({ error: 'ツイートが見つかりません。' });
  }

  const { content } = req.body;
  const cleanContent = sanitizeHtml(content, {
    allowedTags: [],
    allowedAttributes: {}
  });

  if (!cleanContent || cleanContent.length > 280) {
    logger.warn(`返信失敗: 無効な内容。ユーザー=${req.user.username}`);
    return res.status(400).json({ error: '返信は1～280文字で入力してください。' });
  }

  const reply = {
    id: (tweet.replies ? tweet.replies.length : 0) + 1,
    username: req.user.username,
    content: cleanContent,
    timestamp: new Date().toISOString()
  };

  if (!tweet.replies) tweet.replies = [];
  tweet.replies.push(reply);

  if (tweet.username !== req.user.username) {
    notifications.push({
      username: tweet.username,
      message: `${req.user.username} があなたのツイートに返信しました: ${cleanContent.substring(0, 50)}...`,
      timestamp: new Date().toISOString(),
      read: false
    });
  }

  logger.info(`返信成功: ユーザー=${req.user.username}, ツイートID=${tweetId}`);
  res.status(201).json(reply);
});

// ツイート削除（管理者専用）
app.delete('/tweets/:id', authenticateToken, (req, res) => {
  if (!req.user.isAdmin) {
    logger.warn(`ツイート削除失敗: 管理者権限がありません。ユーザー=${req.user.username}`);
    return res.status(403).json({ error: '管理者権限が必要です。' });
  }

  const tweetId = parseInt(req.params.id);
  const tweetIndex = tweets.findIndex(t => t.id === tweetId);

  if (tweetIndex === -1) {
    logger.warn(`ツイート削除失敗: ツイートが見つかりません。ID=${tweetId}`);
    return res.status(404).json({ error: 'ツイートが見つかりません。' });
  }

  const tweet = tweets[tweetIndex];
  tweets.splice(tweetIndex, 1);
  activityLog.push({
    username: req.user.username,
    action: `ツイート削除 (ID: ${tweetId})`,
    timestamp: new Date().toISOString()
  });

  logger.info(`ツイート削除成功: ユーザー=${req.user.username}, ツイートID=${tweetId}`);
  res.json({ message: 'ツイートを削除しました。' });
});

// ツイートピン留め（管理者専用）
app.post('/tweets/:id/pin', authenticateToken, (req, res) => {
  if (!req.user.isAdmin) {
    logger.warn(`ピン留め失敗: 管理者権限がありません。ユーザー=${req.user.username}`);
    return res.status(403).json({ error: '管理者権限が必要です。' });
  }

  const tweetId = parseInt(req.params.id);
  const tweet = tweets.find(t => t.id === tweetId);

  if (!tweet) {
    logger.warn(`ピン留め失敗: ツイートが見つかりません。ID=${tweetId}`);
    return res.status(404).json({ error: 'ツイートが見つかりません。' });
  }

  tweet.pinned = !tweet.pinned;
  activityLog.push({
    username: req.user.username,
    action: `ツイート${tweet.pinned ? 'ピン留め' : 'ピン解除'} (ID: ${tweetId})`,
    timestamp: new Date().toISOString()
  });

  logger.info(`ピン留め成功: ユーザー=${req.user.username}, ツイートID=${tweetId}, 状態=${tweet.pinned}`);
  res.json({ message: tweet.pinned ? 'ツイートをピン留めしました。' : 'ピン留めを解除しました。' });
});

// ユーザー情報取得
app.get('/users/:username', authenticateToken, (req, res) => {
  const targetUsername = req.params.username;
  const user = users.find(u => u.username === targetUsername);

  if (!user) {
    logger.warn(`ユーザー情報取得失敗: ユーザー名 ${targetUsername} が見つかりません。`);
    return res.status(404).json({ error: 'ユーザーが見つかりません。' });
  }

  const recentTweets = tweets
    .filter(t => t.username === targetUsername)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, 20);

  logger.info(`ユーザー情報取得成功: ユーザー=${targetUsername}`);
  res.json({
    username: user.username,
    bio: user.bio,
    profileImage: user.profileImage,
    verified: user.verified,
    followingCount: user.following.length,
    followersCount: user.followers.length,
    followers: user.followers,
    recent_tweets: recentTweets
  });
});

// フォロー
app.post('/follow/:username', authenticateToken, (req, res) => {
  const targetUsername = req.params.username;
  const currentUser = req.user.username;

  if (currentUser === targetUsername) {
    logger.warn(`フォロー失敗: 自分自身をフォローできません。ユーザー=${currentUser}`);
    return res.status(400).json({ error: '自分自身をフォローできません。' });
  }

  const targetUser = users.find(u => u.username === targetUsername);
  const currentUserData = users.find(u => u.username === currentUser);

  if (!targetUser) {
    logger.warn(`フォロー失敗: ユーザー名 ${targetUsername} が見つかりません。`);
    return res.status(404).json({ error: 'ユーザーが見つかりません。' });
  }

  if (currentUserData.following.includes(targetUsername)) {
    logger.warn(`フォロー失敗: すでにフォロー済み。ユーザー=${currentUser}, 対象=${targetUsername}`);
    return res.status(400).json({ error: 'すでにフォローしています。' });
  }

  currentUserData.following.push(targetUsername);
  targetUser.followers.push(currentUser);

  notifications.push({
    username: targetUsername,
    message: `${currentUser} があなたをフォローしました。`,
    timestamp: new Date().toISOString(),
    read: false
  });

  activityLog.push({
    username: currentUser,
    action: `${targetUsername} をフォロー`,
    timestamp: new Date().toISOString()
  });

  logger.info(`フォロー成功: ユーザー=${currentUser}, 対象=${targetUsername}`);
  res.json({ message: 'フォローしました。' });
});

// アンフォロー
app.post('/unfollow/:username', authenticateToken, (req, res) => {
  const targetUsername = req.params.username;
  const currentUser = req.user.username;

  if (currentUser === targetUsername) {
    logger.warn(`アンフォロー失敗: 自分自身をアンフォローできません。ユーザー=${currentUser}`);
    return res.status(400).json({ error: '自分自身をアンフォローできません。' });
  }

  const targetUser = users.find(u => u.username === targetUsername);
  const currentUserData = users.find(u => u.username === currentUser);

  if (!targetUser) {
    logger.warn(`アンフォロー失敗: ユーザー名 ${targetUsername} が見つかりません。`);
    return res.status(404).json({ error: 'ユーザーが見つかりません。' });
  }

  if (!currentUserData.following.includes(targetUsername)) {
    logger.warn(`アンフォロー失敗: フォローしていません。ユーザー=${currentUser}, 対象=${targetUsername}`);
    return res.status(400).json({ error: 'フォローしていません。' });
  }

  currentUserData.following = currentUserData.following.filter(u => u !== targetUsername);
  targetUser.followers = targetUser.followers.filter(u => u !== currentUser);

  activityLog.push({
    username: currentUser,
    action: `${targetUsername} をアンフォロー`,
    timestamp: new Date().toISOString()
  });

  logger.info(`アンフォロー成功: ユーザー=${currentUser}, 対象=${targetUsername}`);
  res.json({ message: 'アンフォローしました。' });
});

// プロフィール更新
app.post('/profile/update', authenticateToken, (req, res) => {
  const { bio, themeColor } = req.body;
  const cleanBio = sanitizeHtml(bio, {
    allowedTags: [],
    allowedAttributes: {}
  });

  if (cleanBio.length > 160) {
    logger.warn(`プロフィール更新失敗: 自己紹介が長すぎます。ユーザー=${req.user.username}`);
    return res.status(400).json({ error: '自己紹介は160文字以内にしてください。' });
  }

  const user = users.find(u => u.username === req.user.username);
  user.bio = cleanBio;
  // themeColor はクライアント側で適用（今回は実装省略）

  activityLog.push({
    username: req.user.username,
    action: 'プロフィール更新',
    timestamp: new Date().toISOString()
  });

  logger.info(`プロフィール更新成功: ユーザー=${req.user.username}`);
  res.json({ message: 'プロフィールを更新しました。' });
});

// 通知取得
app.get('/notifications', authenticateToken, (req, res) => {
  const userNotifications = notifications
    .filter(n => n.username === req.user.username)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  userNotifications.forEach(n => {
    if (!n.read) n.read = true;
  });

  logger.info(`通知取得成功: ユーザー=${req.user.username}`);
  res.json({ notifications: userNotifications });
});

// 未読通知数
app.get('/notifications/unread', authenticateToken, (req, res) => {
  const unreadCount = notifications
    .filter(n => n.username === req.user.username && !n.read)
    .length;

  logger.info(`未読通知数取得成功: ユーザー=${req.user.username}, 未読数=${unreadCount}`);
  res.json({ unreadCount });
});

// アナリティクス
app.get('/analytics', authenticateToken, (req, res) => {
  const userTweets = tweets.filter(t => t.username === req.user.username);
  const totalImpressions = userTweets.reduce((sum, t) => sum + t.likes.length + t.retweets.length, 0);
  const totalLikes = userTweets.reduce((sum, t) => sum + t.likes.length, 0);
  const totalRetweets = userTweets.reduce((sum, t) => sum + t.retweets.length, 0);

  const postStats = userTweets.map(t => ({
    content: t.content,
    impressions: t.likes.length + t.retweets.length,
    likes: t.likes.length,
    retweets: t.retweets.length
  }));

  let userStats = [];
  let topHashtags = [];
  if (req.user.isAdmin) {
    userStats = users.map(u => ({
      username: u.username,
      posts: tweets.filter(t => t.username === u.username).length,
      impressions: tweets
        .filter(t => t.username === u.username)
        .reduce((sum, t) => sum + t.likes.length + t.retweets.length, 0),
      likes: tweets
        .filter(t => t.username === u.username)
        .reduce((sum, t) => sum + t.likes.length, 0),
      retweets: tweets
        .filter(t => t.username === u.username)
        .reduce((sum, t) => sum + t.retweets.length, 0),
      followers: u.followers.length
    }));

    const hashtagCounts = {};
    tweets.forEach(t => {
      const hashtags = t.content.match(/#[a-zA-Z0-9_]+/g) || [];
      hashtags.forEach(tag => {
        hashtagCounts[tag] = (hashtagCounts[tag] || 0) + 1;
      });
    });

    topHashtags = Object.entries(hashtagCounts)
      .map(([tag, count]) => ({ tag: tag.substring(1), count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }

  logger.info(`アナリティクス取得成功: ユーザー=${req.user.username}`);
  res.json({
    overview: {
      totalImpressions,
      totalLikes,
      totalRetweets
    },
    postStats,
    userStats,
    topHashtags
  });
});

// ユーザーアクティビティ（管理者専用）
app.get('/users/:username/activity', authenticateToken, (req, res) => {
  if (!req.user.isAdmin) {
    logger.warn(`アクティビティ取得失敗: 管理者権限がありません。ユーザー=${req.user.username}`);
    return res.status(403).json({ error: '管理者権限が必要です。' });
  }

  const targetUsername = req.params.username;
  const userActivity = activityLog
    .filter(log => log.username === targetUsername)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  logger.info(`アクティビティ取得成功: ユーザー=${targetUsername}`);
  res.json({ activityLog: userActivity });
});

// トレンド（管理者専用）
app.get('/trends/hashtags', authenticateToken, (req, res) => {
  if (!req.user.isAdmin) {
    logger.warn(`トレンド取得失敗: 管理者権限がありません。ユーザー=${req.user.username}`);
    return res.status(403).json({ error: '管理者権限が必要です。' });
  }

  const hashtagCounts = {};
  tweets.forEach(t => {
    const hashtags = t.content.match(/#[a-zA-Z0-9_]+/g) || [];
    hashtags.forEach(tag => {
      hashtagCounts[tag] = (hashtagCounts[tag] || 0) + 1;
    });
  });

  const trends = Object.entries(hashtagCounts)
    .map(([tag, count]) => ({ tag: tag.substring(1), count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  logger.info(`トレンド取得成功: ユーザー=${req.user.username}`);
  res.json({ trends });
});

// ユーザーBAN（管理者専用）
app.post('/ban/:username', authenticateToken, (req, res) => {
  if (!req.user.isAdmin) {
    logger.warn(`BAN失敗: 管理者権限がありません。ユーザー=${req.user.username}`);
    return res.status(403).json({ error: '管理者権限が必要です。' });
  }

  const targetUsername = req.params.username;
  const userIndex = users.findIndex(u => u.username === targetUsername);

  if (userIndex === -1) {
    logger.warn(`BAN失敗: ユーザー名 ${targetUsername} が見つかりません。`);
    return res.status(404).json({ error: 'ユーザーが見つかりません。' });
  }

  users.splice(userIndex, 1);
  tweets = tweets.filter(t => t.username !== targetUsername);
  notifications = notifications.filter(n => n.username !== targetUsername);
  activityLog.push({
    username: req.user.username,
    action: `${targetUsername} をBAN`,
    timestamp: new Date().toISOString()
  });

  logger.info(`BAN成功: ユーザー=${targetUsername}, 実行者=${req.user.username}`);
  res.json({ message: 'ユーザーをBANしました。' });
});

// 警告送信（管理者専用）
app.post('/warn/:username', authenticateToken, (req, res) => {
  if (!req.user.isAdmin) {
    logger.warn(`警告送信失敗: 管理者権限がありません。ユーザー=${req.user.username}`);
    return res.status(403).json({ error: '管理者権限が必要です。' });
  }

  const targetUsername = req.params.username;
  const { message } = req.body;
  const cleanMessage = sanitizeHtml(message, {
    allowedTags: [],
    allowedAttributes: {}
  });

  if (!cleanMessage) {
    logger.warn(`警告送信失敗: メッセージが空です。対象=${targetUsername}`);
    return res.status(400).json({ error: 'メッセージが必要です。' });
  }

  const targetUser = users.find(u => u.username === targetUsername);
  if (!targetUser) {
    logger.warn(`警告送信失敗: ユーザー名 ${targetUsername} が見つかりません。`);
    return res.status(404).json({ error: 'ユーザーが見つかりません。' });
  }

  notifications.push({
    username: targetUsername,
    message: `管理者からの警告: ${cleanMessage}`,
    timestamp: new Date().toISOString(),
    read: false
  });

  activityLog.push({
    username: req.user.username,
    action: `${targetUsername} に警告送信`,
    timestamp: new Date().toISOString()
  });

  logger.info(`警告送信成功: 対象=${targetUsername}, 実行者=${req.user.username}`);
  res.json({ message: '警告を送信しました。' });
});

// アナウンス（管理者専用）
app.post('/announce', authenticateToken, (req, res) => {
  if (!req.user.isAdmin) {
    logger.warn(`アナウンス失敗: 管理者権限がありません。ユーザー=${req.user.username}`);
    return res.status(403).json({ error: '管理者権限が必要です。' });
  }

  const { message } = req.body;
  const cleanMessage = sanitizeHtml(message, {
    allowedTags: [],
    allowedAttributes: {}
  });

  if (!cleanMessage) {
    logger.warn(`アナウンス失敗: メッセージが空です。`);
    return res.status(400).json({ error: 'メッセージが必要です。' });
  }

  users.forEach(user => {
    if (user.username !== req.user.username) {
      notifications.push({
        username: user.username,
        message: `管理者からのアナウンス: ${cleanMessage}`,
        timestamp: new Date().toISOString(),
        read: false
      });
    }
  });

  activityLog.push({
    username: req.user.username,
    action: 'アナウンス送信',
    timestamp: new Date().toISOString()
  });

  logger.info(`アナウンス送信成功: 実行者=${req.user.username}`);
  res.json({ message: 'アナウンスを送信しました。' });
});

// サーバー起動
app.listen(port, () => {
  logger.info(`サーバーがポート ${port} で起動しました。`);
});
