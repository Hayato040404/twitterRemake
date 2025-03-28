const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const app = express();
const port = process.env.PORT || 3000;

// ミドルウェア
app.use(express.json());
app.use(express.static('public'));

// ダミーデータ（本番ではデータベースを使用）
let users = [
  { username: 'admin', password: bcrypt.hashSync('admin123', 10), isAdmin: true, following: [], followers: [], bio: '', profileImage: '', verified: true }
];
let tweets = [];
let notifications = []; // ここで1回だけ宣言
let activityLog = [];

// トークン生成
function generateToken(user) {
  return jwt.sign({ username: user.username, isAdmin: user.isAdmin }, 'secretkey', { expiresIn: '1h' });
}

// トークン認証ミドルウェア
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'トークンが必要です。' });

  jwt.verify(token, 'secretkey', (err, user) => {
    if (err) return res.status(403).json({ error: 'トークンが無効です。' });
    req.user = user;
    next();
  });
}

// 通知を追加する関数（未読フラグを追加）
function addNotification(username, message) {
  notifications.push({
    username,
    message,
    timestamp: new Date(),
    read: false // 未読フラグ
  });
}

// 新規登録
app.post('/register', async (req, res) => {
  const { username, password } = req.body;
  if (users.find(u => u.username === username)) {
    return res.status(400).json({ error: 'ユーザー名がすでに存在します。' });
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  users.push({
    username,
    password: hashedPassword,
    isAdmin: false,
    following: [],
    followers: [],
    bio: '',
    profileImage: '',
    verified: false
  });

  activityLog.push({ username, action: '新規登録', timestamp: new Date() });
  res.status(201).json({ message: '登録成功！' });
});

// ログイン
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const user = users.find(u => u.username === username);
  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(401).json({ error: 'ユーザー名またはパスワードが間違っています。' });
  }

  const token = generateToken(user);
  activityLog.push({ username, action: 'ログイン', timestamp: new Date() });
  res.json({ token });
});

// ツイート投稿
app.post('/tweets', authenticateToken, (req, res) => {
  const { content } = req.body;
  const user = req.user;

  const tweet = {
    id: tweets.length + 1,
    username: user.username,
    content,
    timestamp: new Date(),
    likes: [],
    retweets: [],
    pinned: false,
    replies: []
  };

  tweets.push(tweet);
  activityLog.push({ username: user.username, action: 'ツイート投稿', timestamp: new Date() });

  // フォロワーに通知
  const userData = users.find(u => u.username === user.username);
  userData.followers.forEach(follower => {
    addNotification(follower, `${user.username}が新しいツイートを投稿しました: ${content}`);
  });

  res.status(201).json(tweet);
});

// ツイートに返信
app.post('/tweets/:id/reply', authenticateToken, (req, res) => {
  const tweetId = parseInt(req.params.id);
  const { content } = req.body;
  const user = req.user;

  const tweet = tweets.find(t => t.id === tweetId);
  if (!tweet) {
    return res.status(404).json({ error: 'ツイートが見つかりません。' });
  }

  if (!tweet.replies) {
    tweet.replies = [];
  }

  const reply = {
    id: tweet.replies.length + 1,
    username: user.username,
    content,
    timestamp: new Date(),
    likes: [],
    retweets: []
  };

  tweet.replies.push(reply);

  // 投稿者に通知
  if (tweet.username !== user.username) {
    addNotification(tweet.username, `${user.username}があなたのツイートに返信しました: ${content}`);
  }

  activityLog.push({ username: user.username, action: `ツイート${tweetId}に返信`, timestamp: new Date() });
  res.status(201).json(reply);
});

// フォロー中のタイムライン
app.get('/timeline/following', authenticateToken, (req, res) => {
  const user = req.user;
  const userData = users.find(u => u.username === user.username);
  const followingTweets = tweets
    .filter(t => userData.following.includes(t.username) || t.username === user.username)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  res.json({ tweets: followingTweets });
});

// おすすめタイムライン
app.get('/timeline/recommended', authenticateToken, (req, res) => {
  const user = req.user;
  const recommendedTweets = tweets
    .filter(t => t.username !== user.username)
    .sort((a, b) => (b.likes.length + b.retweets.length) - (a.likes.length + a.retweets.length));

  res.json({ tweets: recommendedTweets });
});

// いいね
app.post('/tweets/:id/like', authenticateToken, (req, res) => {
  const tweetId = parseInt(req.params.id);
  const user = req.user;

  const tweet = tweets.find(t => t.id === tweetId);
  if (!tweet) {
    return res.status(404).json({ error: 'ツイートが見つかりません。' });
  }

  if (tweet.likes.includes(user.username)) {
    tweet.likes = tweet.likes.filter(u => u !== user.username);
  } else {
    tweet.likes.push(user.username);
    if (tweet.username !== user.username) {
      addNotification(tweet.username, `${user.username}があなたのツイートにいいねしました。`);
    }
  }

  activityLog.push({ username: user.username, action: `ツイート${tweetId}にいいね`, timestamp: new Date() });
  res.json({ likes_count: tweet.likes.length });
});

// リツイート
app.post('/tweets/:id/retweet', authenticateToken, (req, res) => {
  const tweetId = parseInt(req.params.id);
  const user = req.user;

  const tweet = tweets.find(t => t.id === tweetId);
  if (!tweet) {
    return res.status(404).json({ error: 'ツイートが見つかりません。' });
  }

  if (tweet.retweets.includes(user.username)) {
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
    timestamp: new Date(),
    likes: [],
    retweets: [],
    pinned: false,
    originalTweetId: tweetId
  };

  tweets.push(retweet);
  activityLog.push({ username: user.username, action: `ツイート${tweetId}をリツイート`, timestamp: new Date() });
  res.status(201).json(retweet);
});

// ツイート削除（管理者専用）
app.delete('/tweets/:id', authenticateToken, (req, res) => {
  const tweetId = parseInt(req.params.id);
  const user = req.user;

  if (!user.isAdmin) {
    return res.status(403).json({ error: '管理者権限が必要です。' });
  }

  const tweetIndex = tweets.findIndex(t => t.id === tweetId);
  if (tweetIndex === -1) {
    return res.status(404).json({ error: 'ツイートが見つかりません。' });
  }

  tweets.splice(tweetIndex, 1);
  activityLog.push({ username: user.username, action: `ツイート${tweetId}を削除`, timestamp: new Date() });
  res.json({ message: 'ツイートを削除しました。' });
});

// ツイートピン留め（管理者専用）
app.post('/tweets/:id/pin', authenticateToken, (req, res) => {
  const tweetId = parseInt(req.params.id);
  const user = req.user;

  if (!user.isAdmin) {
    return res.status(403).json({ error: '管理者権限が必要です。' });
  }

  const tweet = tweets.find(t => t.id === tweetId);
  if (!tweet) {
    return res.status(404).json({ error: 'ツイートが見つかりません。' });
  }

  tweet.pinned = !tweet.pinned;
  activityLog.push({ username: user.username, action: `ツイート${tweetId}を${tweet.pinned ? 'ピン留め' : 'ピン解除'}`, timestamp: new Date() });
  res.json({ message: tweet.pinned ? 'ツイートをピン留めしました。' : 'ピン留めを解除しました。' });
});

// プロフィール取得
app.get('/users/:username', authenticateToken, (req, res) => {
  const username = req.params.username;
  const user = users.find(u => u.username === username);
  if (!user) {
    return res.status(404).json({ error: 'ユーザーが見つかりません。' });
  }

  const recentTweets = tweets
    .filter(t => t.username === username && !t.originalTweetId)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, 10);

  res.json({
    username: user.username,
    bio: user.bio,
    profileImage: user.profileImage,
    verified: user.verified,
    following: user.following.length,
    followers: user.followers.length,
    recent_tweets: recentTweets
  });
});

// プロフィール更新
app.post('/profile/update', authenticateToken, (req, res) => {
  const { bio, themeColor } = req.body;
  const user = req.user;

  const userData = users.find(u => u.username === user.username);
  if (!userData) {
    return res.status(404).json({ error: 'ユーザーが見つかりません。' });
  }

  userData.bio = bio;
  userData.themeColor = themeColor;
  activityLog.push({ username: user.username, action: 'プロフィール更新', timestamp: new Date() });
  res.json({ message: 'プロフィールを更新しました。' });
});

// 通知の取得（既読に更新）
app.get('/notifications', authenticateToken, (req, res) => {
  const user = req.user;
  const userNotifications = notifications.filter(n => n.username === user.username);

  // 未読通知を既読に更新
  userNotifications.forEach(n => {
    if (!n.read) n.read = true;
  });

  res.json({ notifications: userNotifications });
});

// 未読通知数の取得
app.get('/notifications/unread', authenticateToken, (req, res) => {
  const user = req.user;
  const unreadCount = notifications.filter(n => n.username === user.username && !n.read).length;
  res.json({ unreadCount });
});

// フォロー
app.post('/follow/:username', authenticateToken, (req, res) => {
  const usernameToFollow = req.params.username;
  const user = req.user;

  if (usernameToFollow === user.username) {
    return res.status(400).json({ error: '自分自身をフォローすることはできません。' });
  }

  const targetUser = users.find(u => u.username === usernameToFollow);
  if (!targetUser) {
    return res.status(404).json({ error: 'ユーザーが見つかりません。' });
  }

  const userData = users.find(u => u.username === user.username);
  if (!userData.following.includes(usernameToFollow)) {
    userData.following.push(usernameToFollow);
    targetUser.followers.push(user.username);

    // フォローされたユーザーに通知
    addNotification(usernameToFollow, `${user.username}があなたをフォローしました。`);
    activityLog.push({ username: user.username, action: `${usernameToFollow}をフォロー`, timestamp: new Date() });
  }

  res.json({ message: `${usernameToFollow}をフォローしました。` });
});

// アンフォロー
app.post('/unfollow/:username', authenticateToken, (req, res) => {
  const usernameToUnfollow = req.params.username;
  const user = req.user;

  if (usernameToUnfollow === user.username) {
    return res.status(400).json({ error: '自分自身をアンフォローすることはできません。' });
  }

  const targetUser = users.find(u => u.username === usernameToUnfollow);
  if (!targetUser) {
    return res.status(404).json({ error: 'ユーザーが見つかりません。' });
  }

  const userData = users.find(u => u.username === user.username);
  userData.following = userData.following.filter(u => u !== usernameToUnfollow);
  targetUser.followers = targetUser.followers.filter(u => u !== user.username);

  // アンフォローされたユーザーに通知
  addNotification(usernameToUnfollow, `${user.username}があなたをアンフォローしました。`);
  activityLog.push({ username: user.username, action: `${usernameToUnfollow}をアンフォロー`, timestamp: new Date() });

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

  res.json(responseData);
});

// ユーザーBAN（管理者専用）
app.post('/ban/:username', authenticateToken, (req, res) => {
  const username = req.params.username;
  const user = req.user;

  if (!user.isAdmin) {
    return res.status(403).json({ error: '管理者権限が必要です。' });
  }

  const userIndex = users.findIndex(u => u.username === username);
  if (userIndex === -1) {
    return res.status(404).json({ error: 'ユーザーが見つかりません。' });
  }

  users.splice(userIndex, 1);
  tweets = tweets.filter(t => t.username !== username);
  activityLog.push({ username: user.username, action: `${username}をBAN`, timestamp: new Date() });
  res.json({ message: `${username}をBANしました。` });
});

// ユーザーへの警告（管理者専用）
app.post('/warn/:username', authenticateToken, (req, res) => {
  const username = req.params.username;
  const { message } = req.body;
  const user = req.user;

  if (!user.isAdmin) {
    return res.status(403).json({ error: '管理者権限が必要です。' });
  }

  const targetUser = users.find(u => u.username === username);
  if (!targetUser) {
    return res.status(404).json({ error: 'ユーザーが見つかりません。' });
  }

  addNotification(username, `管理者からの警告: ${message}`);
  activityLog.push({ username: user.username, action: `${username}に警告`, timestamp: new Date() });
  res.json({ message: `${username}に警告を送信しました。` });
});

// 全ユーザーへのアナウンス（管理者専用）
app.post('/announce', authenticateToken, (req, res) => {
  const { message } = req.body;
  const user = req.user;

  if (!user.isAdmin) {
    return res.status(403).json({ error: '管理者権限が必要です。' });
  }

  users.forEach(u => {
    if (u.username !== user.username) {
      addNotification(u.username, `管理者からのアナウンス: ${message}`);
    }
  });

  activityLog.push({ username: user.username, action: 'アナウンス送信', timestamp: new Date() });
  res.json({ message: 'アナウンスを送信しました。' });
});

// ユーザーアクティビティログ（管理者専用）
app.get('/users/:username/activity', authenticateToken, (req, res) => {
  const username = req.params.username;
  const user = req.user;

  if (!user.isAdmin) {
    return res.status(403).json({ error: '管理者権限が必要です。' });
  }

  const userActivity = activityLog.filter(log => log.username === username);
  res.json({ activityLog: userActivity });
});

// ハッシュタグトレンド（管理者専用）
app.get('/trends/hashtags', authenticateToken, (req, res) => {
  const user = req.user;

  if (!user.isAdmin) {
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

  res.json({ trends });
});

// サーバー起動
app.listen(port, () => {
  console.log(`サーバーがポート${port}で起動しました。`);
});
