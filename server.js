const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const winston = require('winston');
const sanitizeHtml = require('sanitize-html');
const app = express();
const port = process.env.PORT || 3000;

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

// メモリ上のデータ（サーバー再起動でリセット）
let users = [
  {
    username: 'admin',
    password: bcrypt.hashSync('admin123', 10),
    isAdmin: true,
    following: [],
    followers: [],
    bio: '',
    profileImage: '',
    verified: true,
    createdAt: new Date().toISOString()
  },
  {
    username: 'Hal',
    password: bcrypt.hashSync('hayato0429', 10),
    isAdmin: true,
    following: [],
    followers: [],
    bio: '管理者アカウント',
    profileImage: '',
    verified: true,
    createdAt: new Date().toISOString()
  }
];
let tweets = [];
let notifications = [];
let activityLog = [];

// 入力バリデーション関数
function validateInput(input) {
  if (!input || typeof input !== 'string' || input.trim() === '') {
    return false;
  }
  const validPattern = /^[a-zA-Z0-9_@.-]+$/;
  return validPattern.test(input);
}

// トークン生成
function generateToken(user) {
  return jwt.sign({ username: user.username, isAdmin: user.isAdmin }, 'secretkey', { expiresIn: '1h' });
}

// トークン認証ミドルウェア
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) {
    logger.warn('トークンが見つかりません。');
    return res.status(401).json({ error: 'トークンが必要です。' });
  }

  jwt.verify(token, 'secretkey', (err, user) => {
    if (err) {
      logger.warn('トークンが無効です:', err.message);
      return res.status(403).json({ error: 'トークンが無効です。' });
    }
    req.user = user;
    next();
  });
}

// 通知を追加する関数
function addNotification(username, message) {
  const sanitizedMessage = sanitizeHtml(message, {
    allowedTags: [],
    allowedAttributes: {}
  });
  notifications.push({
    username,
    message: sanitizedMessage,
    timestamp: new Date().toISOString(),
    read: false
  });
  logger.info(`通知を追加: ユーザー=${username}, メッセージ=${sanitizedMessage}`);
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
    res.status(201).json({ message: '登録成功！' });
  } catch (error) {
    logger.error('新規登録エラー:', error);
    res.status(500).json({ error: 'サーバーエラーが発生しました。' });
  }
});

// ログイン
app.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!validateInput(username) || !validateInput(password)) {
    logger.warn('ログイン: 無効な入力', { username });
    return res.status(400).json({ error: 'ユーザー名またはパスワードが無効です。英数字と一部の記号（_@.-）のみ使用可能です。' });
  }

  try {
    const user = users.find(u => u.username === username);
    if (!user) {
      logger.warn(`ログイン失敗: ユーザー名 ${username} が見つかりません。`);
      return res.status(401).json({ error: 'ユーザー名またはパスワードが間違っています。' });
    }

    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      logger.warn(`ログイン失敗: パスワードが一致しません: ユーザー=${username}`);
      return res.status(401).json({ error: 'ユーザー名またはパスワードが間違っています。' });
    }

    const token = generateToken(user);
    activityLog.push({
      username,
      action: 'ログイン',
      timestamp: new Date().toISOString()
    });

    logger.info(`ログイン成功: ユーザー=${username}, トークン=${token}`);
    res.json({ token });
  } catch (error) {
    logger.error('ログインエラー:', error);
    res.status(500).json({ error: 'サーバーエラーが発生しました。' });
  }
});

// ツイート投稿
app.post('/tweets', authenticateToken, (req, res) => {
  const { content } = req.body;
  const user = req.user;

  if (!content || typeof content !== 'string' || content.trim() === '') {
    logger.warn('ツイート投稿: 無効な内容', { username: user.username });
    return res.status(400).json({ error: 'ツイート内容が無効です。' });
  }

  const sanitizedContent = sanitizeHtml(content, {
    allowedTags: [],
    allowedAttributes: {}
  });

  const tweet = {
    id: tweets.length + 1,
    username: user.username,
    content: sanitizedContent,
    timestamp: new Date().toISOString(),
    likes: [],
    retweets: [],
    pinned: false,
    replies: []
  };

  tweets.push(tweet);
  activityLog.push({
    username: user.username,
    action: 'ツイート投稿',
    timestamp: new Date().toISOString()
  });

  const userData = users.find(u => u.username === user.username);
  userData.followers.forEach(follower => {
    addNotification(follower, `${user.username}が新しいツイートを投稿しました: ${sanitizedContent}`);
  });

  logger.info(`ツイート投稿成功: ユーザー=${user.username}, 内容=${sanitizedContent}`);
  res.status(201).json(tweet);
});

// ツイートに返信
app.post('/tweets/:id/reply', authenticateToken, (req, res) => {
  const tweetId = parseInt(req.params.id);
  const { content } = req.body;
  const user = req.user;

  if (!content || typeof content !== 'string' || content.trim() === '') {
    logger.warn('返信: 無効な内容', { username: user.username, tweetId });
    return res.status(400).json({ error: '返信内容が無効です。' });
  }

  const sanitizedContent = sanitizeHtml(content, {
    allowedTags: [],
    allowedAttributes: {}
  });

  const tweet = tweets.find(t => t.id === tweetId);
  if (!tweet) {
    logger.warn(`返信失敗: ツイートが見つかりません: ID=${tweetId}`);
    return res.status(404).json({ error: 'ツイートが見つかりません。' });
  }

  if (!tweet.replies) {
    tweet.replies = [];
  }

  const reply = {
    id: tweet.replies.length + 1,
    username: user.username,
    content: sanitizedContent,
    timestamp: new Date().toISOString(),
    likes: [],
    retweets: []
  };

  tweet.replies.push(reply);

  if (tweet.username !== user.username) {
    addNotification(tweet.username, `${user.username}があなたのツイートに返信しました: ${sanitizedContent}`);
  }

  activityLog.push({
    username: user.username,
    action: `ツイート${tweetId}に返信`,
    timestamp: new Date().toISOString()
  });

  logger.info(`返信成功: ユーザー=${user.username}, ツイートID=${tweetId}, 内容=${sanitizedContent}`);
  res.status(201).json(reply);
});

// フォロー中のタイムライン
app.get('/timeline/following', authenticateToken, (req, res) => {
  const user = req.user;
  const userData = users.find(u => u.username === user.username);
  const followingTweets = tweets
    .filter(t => userData.following.includes(t.username) || t.username === user.username)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  logger.info(`フォロー中タイムライン取得: ユーザー=${user.username}`);
  res.json({ tweets: followingTweets });
});

// おすすめタイムライン
app.get('/timeline/recommended', authenticateToken, (req, res) => {
  const user = req.user;
  const recommendedTweets = tweets
    .filter(t => t.username !== user.username)
    .sort((a, b) => (b.likes.length + b.retweets.length) - (a.likes.length + a.retweets.length));

  logger.info(`おすすめタイムライン取得: ユーザー=${user.username}`);
  res.json({ tweets: recommendedTweets });
});

// いいね
app.post('/tweets/:id/like', authenticateToken, (req, res) => {
  const tweetId = parseInt(req.params.id);
  const user = req.user;

  const tweet = tweets.find(t => t.id === tweetId);
  if (!tweet) {
    logger.warn(`いいね失敗: ツイートが見つかりません: ID=${tweetId}`);
    return res.status(404).json({ error: 'ツイートが見つかりません。' });
  }

  if (tweet.likes.includes(user.username)) {
    tweet.likes = tweet.likes.filter(u => u !== user.username);
    logger.info(`いいね解除: ユーザー=${user.username}, ツイートID=${tweetId}`);
  } else {
    tweet.likes.push(user.username);
    if (tweet.username !== user.username) {
      addNotification(tweet.username, `${user.username}があなたのツイートにいいねしました。`);
    }
    logger.info(`いいね成功: ユーザー=${user.username}, ツイートID=${tweetId}`);
  }

  activityLog.push({
    username: user.username,
    action: `ツイート${tweetId}にいいね`,
    timestamp: new Date().toISOString()
  });

  res.json({ likes_count: tweet.likes.length });
});

// リツイート
app.post('/tweets/:id/retweet', authenticateToken, (req, res) => {
  const tweetId = parseInt(req.params.id);
  const user = req.user;

  const tweet = tweets.find(t => t.id === tweetId);
  if (!tweet) {
    logger.warn(`リツイート失敗: ツイートが見つかりません: ID=${tweetId}`);
    return res.status(404).json({ error: 'ツイートが見つかりません。' });
  }

  if (tweet.retweets.includes(user.username)) {
    logger.warn(`リツイート失敗: すでにリツイート済み: ユーザー=${user.username}, ツイートID=${tweetId}`);
    return res.status(400).json({ error: 'すでにリツイートしています。' });
  }

  tweet.retweets.push(user.username);
  if (tweet.username !== user.username) {
    addNotification(tweet.username, `${user.username}があなたのツイートをリツイートしました。`);
  }

  const retweet = {
    id: tweets.length + 1,
    username: user.username,
    content: `RT: ${tweet.content}`,
    timestamp: new Date().toISOString(),
    likes: [],
    retweets: [],
    pinned: false,
    originalTweetId: tweetId
  };

  tweets.push(retweet);
  activityLog.push({
    username: user.username,
    action: `ツイート${tweetId}をリツイート`,
    timestamp: new Date().toISOString()
  });

  logger.info(`リツイート成功: ユーザー=${user.username}, ツイートID=${tweetId}`);
  res.status(201).json(retweet);
});

// ツイート削除（管理者専用）
app.delete('/tweets/:id', authenticateToken, (req, res) => {
  const tweetId = parseInt(req.params.id);
  const user = req.user;

  if (!user.isAdmin) {
    logger.warn(`ツイート削除失敗: 管理者権限なし: ユーザー=${user.username}, ツイートID=${tweetId}`);
    return res.status(403).json({ error: '管理者権限が必要です。' });
  }

  const tweetIndex = tweets.findIndex(t => t.id === tweetId);
  if (tweetIndex === -1) {
    logger.warn(`ツイート削除失敗: ツイートが見つかりません: ID=${tweetId}`);
    return res.status(404).json({ error: 'ツイートが見つかりません。' });
  }

  tweets.splice(tweetIndex, 1);
  activityLog.push({
    username: user.username,
    action: `ツイート${tweetId}を削除`,
    timestamp: new Date().toISOString()
  });

  logger.info(`ツイート削除成功: ユーザー=${user.username}, ツイートID=${tweetId}`);
  res.json({ message: 'ツイートを削除しました。' });
});

// ツイートピン留め（管理者専用）
app.post('/tweets/:id/pin', authenticateToken, (req, res) => {
  const tweetId = parseInt(req.params.id);
  const user = req.user;

  if (!user.isAdmin) {
    logger.warn(`ピン留め失敗: 管理者権限なし: ユーザー=${user.username}, ツイートID=${tweetId}`);
    return res.status(403).json({ error: '管理者権限が必要です。' });
  }

  const tweet = tweets.find(t => t.id === tweetId);
  if (!tweet) {
    logger.warn(`ピン留め失敗: ツイートが見つかりません: ID=${tweetId}`);
    return res.status(404).json({ error: 'ツイートが見つかりません。' });
  }

  tweet.pinned = !tweet.pinned;
  activityLog.push({
    username: user.username,
    action: `ツイート${tweetId}を${tweet.pinned ? 'ピン留め' : 'ピン解除'}`,
    timestamp: new Date().toISOString()
  });

  logger.info(`ピン留め/解除成功: ユーザー=${user.username}, ツイートID=${tweetId}, 状態=${tweet.pinned}`);
  res.json({ message: tweet.pinned ? 'ツイートをピン留めしました。' : 'ピン留めを解除しました。' });
});

// プロフィール取得
app.get('/users/:username', authenticateToken, (req, res) => {
  const username = req.params.username;
  const user = users.find(u => u.username === username);
  if (!user) {
    logger.warn(`プロフィール取得失敗: ユーザーが見つかりません: ユーザー=${username}`);
    return res.status(404).json({ error: 'ユーザーが見つかりません。' });
  }

  const recentTweets = tweets
    .filter(t => t.username === username && !t.originalTweetId)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, 10);

  const responseData = {
    username: user.username,
    bio: user.bio,
    profileImage: user.profileImage,
    verified: user.verified,
    followingCount: user.following.length,
    followersCount: user.followers.length,
    followers: user.followers,
    recent_tweets: recentTweets
  };

  logger.info(`プロフィール取得成功: ユーザー=${username}`);
  res.json(responseData);
});

// プロフィール更新
app.post('/profile/update', authenticateToken, (req, res) => {
  const { bio, themeColor } = req.body;
  const user = req.user;

  if (typeof bio !== 'string' || typeof themeColor !== 'string') {
    logger.warn('プロフィール更新: 無効な入力', { username: user.username });
    return res.status(400).json({ error: '無効な入力です。' });
  }

  const userData = users.find(u => u.username === user.username);
  if (!userData) {
    logger.warn(`プロフィール更新失敗: ユーザーが見つかりません: ユーザー=${user.username}`);
    return res.status(404).json({ error: 'ユーザーが見つかりません。' });
  }

  userData.bio = sanitizeHtml(bio, { allowedTags: [], allowedAttributes: {} });
  userData.themeColor = sanitizeHtml(themeColor, { allowedTags: [], allowedAttributes: {} });
  activityLog.push({
    username: user.username,
    action: 'プロフィール更新',
    timestamp: new Date().toISOString()
  });

  logger.info(`プロフィール更新成功: ユーザー=${user.username}`);
  res.json({ message: 'プロフィールを更新しました。' });
});

// 通知の取得（既読に更新）
app.get('/notifications', authenticateToken, (req, res) => {
  const user = req.user;
  const userNotifications = notifications.filter(n => n.username === user.username);

  userNotifications.forEach(n => {
    if (!n.read) n.read = true;
  });

  logger.info(`通知取得成功: ユーザー=${user.username}`);
  res.json({ notifications: userNotifications });
});

// 未読通知数の取得
app.get('/notifications/unread', authenticateToken, (req, res) => {
  const user = req.user;
  const unreadCount = notifications.filter(n => n.username === user.username && !n.read).length;

  logger.info(`未読通知数取得成功: ユーザー=${user.username}, 未読数=${unreadCount}`);
  res.json({ unreadCount });
});

// フォロー
app.post('/follow/:username', authenticateToken, (req, res) => {
  const usernameToFollow = req.params.username;
  const user = req.user;

  if (usernameToFollow === user.username) {
    logger.warn(`フォロー失敗: 自分自身をフォローすることはできません: ユーザー=${user.username}`);
    return res.status(400).json({ error: '自分自身をフォローすることはできません。' });
  }

  const targetUser = users.find(u => u.username === usernameToFollow);
  if (!targetUser) {
    logger.warn(`フォロー失敗: ユーザーが見つかりません: ターゲット=${usernameToFollow}`);
    return res.status(404).json({ error: 'ユーザーが見つかりません。' });
  }

  const userData = users.find(u => u.username === user.username);
  if (!userData.following.includes(usernameToFollow)) {
    userData.following.push(usernameToFollow);
    targetUser.followers.push(user.username);

    addNotification(usernameToFollow, `${user.username}があなたをフォローしました。`);
    activityLog.push({
      username: user.username,
      action: `${usernameToFollow}をフォロー`,
      timestamp: new Date().toISOString()
    });

    logger.info(`フォロー成功: ユーザー=${user.username}, ターゲット=${usernameToFollow}`);
  }

  res.json({ message: `${usernameToFollow}をフォローしました。` });
});

// アンフォロー
app.post('/unfollow/:username', authenticateToken, (req, res) => {
  const usernameToUnfollow = req.params.username;
  const user = req.user;

  if (usernameToUnfollow === user.username) {
    logger.warn(`アンフォロー失敗: 自分自身をアンフォローすることはできません: ユーザー=${user.username}`);
    return res.status(400).json({ error: '自分自身をアンフォローすることはできません。' });
  }

  const targetUser = users.find(u => u.username === usernameToUnfollow);
  if (!targetUser) {
    logger.warn(`アンフォロー失敗: ユーザーが見つかりません: ターゲット=${usernameToUnfollow}`);
    return res.status(404).json({ error: 'ユーザーが見つかりません。' });
  }

  const userData = users.find(u => u.username === user.username);
  userData.following = userData.following.filter(u => u !== usernameToUnfollow);
  targetUser.followers = targetUser.followers.filter(u => u !== user.username);

  addNotification(usernameToUnfollow, `${user.username}があなたをアンフォローしました。`);
  activityLog.push({
    username: user.username,
    action: `${usernameToUnfollow}をアンフォロー`,
    timestamp: new Date().toISOString()
  });

  logger.info(`アンフォロー成功: ユーザー=${user.username}, ターゲット=${usernameToUnfollow}`);
  res.json({ message: `${usernameToUnfollow}をアンフォローしました。` });
});

// アナリティクス
app.get('/analytics', authenticateToken, (req, res) => {
  const user = req.user;
  const userTweets = tweets.filter(t => t.username === user.username && !t.originalTweetId);

  const overview = {
    totalImpressions: userTweets.reduce((sum, t) => sum + t.likes.length + t.retweets.length, 0),
    totalLikes: userTweets.reduce((sum, t) => sum + t.likes.length, 0),
    totalRetweets: userTweets.reduce((sum, t) => sum + t.retweets.length, 0)
  };

  const postStats = userTweets.map(t => ({
    content: t.content,
    impressions: t.likes.length + t.retweets.length,
    likes: t.likes.length,
    retweets: t.retweets.length
  }));

  let responseData = { overview, postStats };

  if (user.isAdmin) {
    const userStats = users.map(u => ({
      username: u.username,
      posts: tweets.filter(t => t.username === u.username && !t.originalTweetId).length,
      impressions: tweets.filter(t => t.username === u.username).reduce((sum, t) => sum + t.likes.length + t.retweets.length, 0),
      likes: tweets.filter(t => t.username === u.username).reduce((sum, t) => sum + t.likes.length, 0),
      retweets: tweets.filter(t => t.username === u.username).reduce((sum, t) => sum + t.retweets.length, 0),
      followers: u.followers.length
    }));

    const hashtagCounts = {};
    tweets.forEach(t => {
      const hashtags = t.content.match(/#[^\s]+/g) || [];
      hashtags.forEach(tag => {
        const cleanTag = tag.slice(1).toLowerCase();
        hashtagCounts[cleanTag] = (hashtagCounts[cleanTag] || 0) + 1;
      });
    });

    const topHashtags = Object.entries(hashtagCounts)
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    responseData.userStats = userStats;
    responseData.topHashtags = topHashtags;
  }

  logger.info(`アナリティクス取得成功: ユーザー=${user.username}`);
  res.json(responseData);
});

// ユーザーBAN（管理者専用）
app.post('/ban/:username', authenticateToken, (req, res) => {
  const username = req.params.username;
  const user = req.user;

  if (!user.isAdmin) {
    logger.warn(`BAN失敗: 管理者権限なし: ユーザー=${user.username}, ターゲット=${username}`);
    return res.status(403).json({ error: '管理者権限が必要です。' });
  }

  const userIndex = users.findIndex(u => u.username === username);
  if (userIndex === -1) {
    logger.warn(`BAN失敗: ユーザーが見つかりません: ターゲット=${username}`);
    return res.status(404).json({ error: 'ユーザーが見つかりません。' });
  }

  users.splice(userIndex, 1);
  tweets = tweets.filter(t => t.username !== username);
  activityLog.push({
    username: user.username,
    action: `${username}をBAN`,
    timestamp: new Date().toISOString()
  });

  logger.info(`BAN成功: ユーザー=${user.username}, ターゲット=${username}`);
  res.json({ message: `${username}をBANしました。` });
});

// ユーザーへの警告（管理者専用）
app.post('/warn/:username', authenticateToken, (req, res) => {
  const username = req.params.username;
  const { message } = req.body;
  const user = req.user;

  if (!user.isAdmin) {
    logger.warn(`警告失敗: 管理者権限なし: ユーザー=${user.username}, ターゲット=${username}`);
    return res.status(403).json({ error: '管理者権限が必要です。' });
  }

  const targetUser = users.find(u => u.username === username);
  if (!targetUser) {
    logger.warn(`警告失敗: ユーザーが見つかりません: ターゲット=${username}`);
    return res.status(404).json({ error: 'ユーザーが見つかりません。' });
  }

  const sanitizedMessage = sanitizeHtml(message, { allowedTags: [], allowedAttributes: {} });
  addNotification(username, `管理者からの警告: ${sanitizedMessage}`);
  activityLog.push({
    username: user.username,
    action: `${username}に警告`,
    timestamp: new Date().toISOString()
  });

  logger.info(`警告送信成功: ユーザー=${user.username}, ターゲット=${username}, メッセージ=${sanitizedMessage}`);
  res.json({ message: `${username}に警告を送信しました。` });
});

// 全ユーザーへのアナウンス（管理者専用）
app.post('/announce', authenticateToken, (req, res) => {
  const { message } = req.body;
  const user = req.user;

  if (!user.isAdmin) {
    logger.warn(`アナウンス失敗: 管理者権限なし: ユーザー=${user.username}`);
    return res.status(403).json({ error: '管理者権限が必要です。' });
  }

  const sanitizedMessage = sanitizeHtml(message, { allowedTags: [], allowedAttributes: {} });
  users.forEach(u => {
    if (u.username !== user.username) {
      addNotification(u.username, `管理者からのアナウンス: ${sanitizedMessage}`);
    }
  });

  activityLog.push({
    username: user.username,
    action: 'アナウンス送信',
    timestamp: new Date().toISOString()
  });

  logger.info(`アナウンス送信成功: ユーザー=${user.username}, メッセージ=${sanitizedMessage}`);
  res.json({ message: 'アナウンスを送信しました。' });
});

// ユーザーアクティビティログ（管理者専用）
app.get('/users/:username/activity', authenticateToken, (req, res) => {
  const username = req.params.username;
  const user = req.user;

  if (!user.isAdmin) {
    logger.warn(`アクティビティログ取得失敗: 管理者権限なし: ユーザー=${user.username}, ターゲット=${username}`);
    return res.status(403).json({ error: '管理者権限が必要です。' });
  }

  const userActivity = activityLog.filter(log => log.username === username);
  logger.info(`アクティビティログ取得成功: ユーザー=${user.username}, ターゲット=${username}`);
  res.json({ activityLog: userActivity });
});

// ハッシュタグトレンド（管理者専用）
app.get('/trends/hashtags', authenticateToken, (req, res) => {
  const user = req.user;

  if (!user.isAdmin) {
    logger.warn(`トレンド取得失敗: 管理者権限なし: ユーザー=${user.username}`);
    return res.status(403).json({ error: '管理者権限が必要です。' });
  }

  const hashtagCounts = {};
  tweets.forEach(t => {
    const hashtags = t.content.match(/#[^\s]+/g) || [];
    hashtags.forEach(tag => {
      const cleanTag = tag.slice(1).toLowerCase();
      hashtagCounts[cleanTag] = (hashtagCounts[cleanTag] || 0) + 1;
    });
  });

  const trends = Object.entries(hashtagCounts)
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  logger.info(`トレンド取得成功: ユーザー=${user.username}`);
  res.json({ trends });
});

// サーバー起動
app.listen(port, () => {
  logger.info(`サーバーがポート${port}で起動しました。`);
});
