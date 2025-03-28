const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path'); // 追加: ファイルパス操作用
require('dotenv').config();

const app = express();
app.use(express.json());

// 静的ファイル配信（publicディレクトリを公開）
app.use(express.static(path.join(__dirname, 'public')));

// メモリ上のデータベース
let users = [];
let posts = [];
let notifications = [];

// ミドルウェア: 認証
const authenticateToken = (req, res, next) => {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Authentication required' });

  jwt.verify(token, process.env.JWT_SECRET || 'secret_key', (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid token' });
    req.user = user;
    next();
  });
};

// 管理者チェックミドルウェア
const requireAdmin = (req, res, next) => {
  const user = users.find(u => u.id === req.user.id);
  if (!user.isAdmin) return res.status(403).json({ error: 'Admin access required' });
  next();
};

// 新規登録
app.post('/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  if (users.find(u => u.username === username)) return res.status(400).json({ error: 'Username taken' });

  const hashedPassword = await bcrypt.hash(password, 10);
  const user = { 
    id: users.length + 1, 
    username, 
    password: hashedPassword, 
    following: [], 
    followers: [], 
    blocked: [], 
    isAdmin: false, 
    isBanned: false,
    draft: null,
    profileImage: null,
    verified: false,
    bio: '',
    themeColor: '#ffffff',
    activityLog: []
  };
  users.push(user);
  res.status(201).json({ id: user.id, username });
});

// ログイン
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const user = users.find(u => u.username === username);
  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  if (user.isBanned) return res.status(403).json({ error: 'Account banned' });

  const token = jwt.sign({ id: user.id, username, isAdmin: user.isAdmin }, process.env.JWT_SECRET || 'secret_key', { expiresIn: '1h' });
  user.activityLog.push({ action: 'login', timestamp: Date.now() });
  res.json({ token });
});

// 投稿（インプレッション初期化）
app.post('/tweets', authenticateToken, (req, res) => {
  const { content, image } = req.body;
  if (!content) return res.status(400).json({ error: 'Content required' });

  const user = users.find(u => u.id === req.user.id);
  if (!user.isAdmin && content.length > 200) {
    return res.status(400).json({ error: 'Free accounts limited to 200 characters' });
  }

  const hashtags = content.match(/#[^\s#]+/g)?.map(tag => tag.slice(1).toLowerCase()) || [];
  const tweet = {
    id: posts.length + 1,
    userId: req.user.id,
    username: req.user.username,
    content,
    image: image || null,
    hashtags,
    likes: [],
    retweets: [],
    impressions: 0,
    timestamp: Date.now(),
    pinned: false,
    priority: user.isAdmin
  };
  posts.push(tweet);
  user.activityLog.push({ action: 'tweet', tweetId: tweet.id, timestamp: Date.now() });
  res.status(201).json(tweet);
});

// タイムライン（フォロー中、ブロック対応、インプレッションカウント）
app.get('/timeline/following', authenticateToken, (req, res) => {
  const user = users.find(u => u.id === req.user.id);
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const start = (page - 1) * limit;
  const followingTweets = posts
    .filter(p => (p.userId === req.user.id || user.following.includes(p.userId)) && !user.blocked.includes(p.userId))
    .sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      if (a.priority && !b.priority) return -1;
      if (!a.priority && b.priority) return 1;
      return b.timestamp - a.timestamp;
    })
    .slice(start, start + limit);

  followingTweets.forEach(tweet => tweet.impressions += 1);
  res.json({
    tweets: followingTweets,
    meta: { page, limit, total: followingTweets.length }
  });
});

// タイムライン（おすすめ、ブロック対応、インプレッションカウント）
app.get('/timeline/recommended', authenticateToken, (req, res) => {
  const user = users.find(u => u.id === req.user.id);
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const start = (page - 1) * limit;
  const notFollowing = posts.filter(p => !user.following.includes(p.userId) && p.userId !== req.user.id && !user.blocked.includes(p.userId));
  const recommendedTweets = notFollowing
    .map(tweet => ({
      ...tweet,
      score: tweet.likes.length * 2 + tweet.retweets.length
    }))
    .sort((a, b) => b.score - b.timestamp / 1000000 - (a.score - a.timestamp / 1000000))
    .slice(start, start + limit);

  recommendedTweets.forEach(tweet => tweet.impressions += 1);
  res.json({
    tweets: recommendedTweets,
    meta: { page, limit, total: recommendedTweets.length }
  });
});

// 通知タイムライン（ブロック対応）
app.get('/notifications', authenticateToken, (req, res) => {
  const user = users.find(u => u.id === req.user.id);
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const start = (page - 1) * limit;
  const userNotifications = notifications
    .filter(n => n.userId === req.user.id && !user.blocked.includes(users.find(u => u.username === n.message.split(' ')[0])?.id))
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(start, start + limit);
  res.json({
    notifications: userNotifications,
    meta: { page, limit, total: userNotifications.length }
  });
});

// いいね
app.post('/tweets/:id/like', authenticateToken, (req, res) => {
  const tweet = posts.find(t => t.id === Number(req.params.id));
  if (!tweet) return res.status(404).json({ error: 'Tweet not found' });

  const user = users.find(u => u.id === req.user.id);
  if (user.blocked.includes(tweet.userId)) return res.status(403).json({ error: 'User blocked' });

  const liked = tweet.likes.includes(req.user.id);
  tweet.likes = liked ? tweet.likes.filter(id => id !== req.user.id) : [...tweet.likes, req.user.id];
  if (!liked && tweet.userId !== req.user.id) {
    notifications.push({
      id: notifications.length + 1,
      userId: tweet.userId,
      type: 'like',
      message: `${req.user.username} liked your tweet`,
      timestamp: Date.now()
    });
  }
  user.activityLog.push({ action: 'like', tweetId: tweet.id, timestamp: Date.now() });
  res.json({ liked: !liked, likes_count: tweet.likes.length });
});

// リツイート
app.post('/tweets/:id/retweet', authenticateToken, (req, res) => {
  const tweet = posts.find(t => t.id === Number(req.params.id));
  if (!tweet) return res.status(404).json({ error: 'Tweet not found' });

  const user = users.find(u => u.id === req.user.id);
  if (user.blocked.includes(tweet.userId)) return res.status(403).json({ error: 'User blocked' });

  if (tweet.retweets.includes(req.user.id)) return res.status(400).json({ error: 'Already retweeted' });

  tweet.retweets.push(req.user.id);
  const retweet = {
    id: posts.length + 1,
    userId: req.user.id,
    username: req.user.username,
    content: tweet.content,
    image: tweet.image,
    hashtags: tweet.hashtags,
    originalId: tweet.id,
    likes: [],
    retweets: [],
    impressions: 0,
    timestamp: Date.now(),
    pinned: false,
    priority: false
  };
  posts.push(retweet);
  if (tweet.userId !== req.user.id) {
    notifications.push({
      id: notifications.length + 1,
      userId: tweet.userId,
      type: 'retweet',
      message: `${req.user.username} retweeted your tweet`,
      timestamp: Date.now()
    });
  }
  user.activityLog.push({ action: 'retweet', tweetId: tweet.id, timestamp: Date.now() });
  res.json(retweet);
});

// フォロー
app.post('/follow/:username', authenticateToken, (req, res) => {
  const target = users.find(u => u.username === req.params.username);
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.id === req.user.id) return res.status(400).json({ error: 'Cannot follow yourself' });

  const user = users.find(u => u.id === req.user.id);
  if (user.following.includes(target.id)) return res.status(400).json({ error: 'Already following' });
  if (user.blocked.includes(target.id)) return res.status(403).json({ error: 'User blocked' });

  user.following.push(target.id);
  target.followers.push(user.id);
  notifications.push({
    id: notifications.length + 1,
    userId: target.id,
    type: 'follow',
    message: `${req.user.username} followed you`,
    timestamp: Date.now()
  });
  user.activityLog.push({ action: 'follow', targetId: target.id, timestamp: Date.now() });
  res.json({ message: `Now following ${target.username}`, following: user.following.length });
});

// アンフォロー
app.post('/unfollow/:username', authenticateToken, (req, res) => {
  const target = users.find(u => u.username === req.params.username);
  if (!target) return res.status(404).json({ error: 'User not found' });

  const user = users.find(u => u.id === req.user.id);
  if (!user.following.includes(target.id)) return res.status(400).json({ error: 'Not following this user' });

  user.following = user.following.filter(id => id !== target.id);
  target.followers = target.followers.filter(id => id !== user.id);
  user.activityLog.push({ action: 'unfollow', targetId: target.id, timestamp: Date.now() });
  res.json({ message: `Unfollowed ${target.username}`, following: user.following.length });
});

// ブロック
app.post('/block/:username', authenticateToken, (req, res) => {
  const target = users.find(u => u.username === req.params.username);
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.id === req.user.id) return res.status(400).json({ error: 'Cannot block yourself' });

  const user = users.find(u => u.id === req.user.id);
  if (user.blocked.includes(target.id)) return res.status(400).json({ error: 'Already blocked' });

  user.blocked.push(target.id);
  user.following = user.following.filter(id => id !== target.id);
  target.followers = target.followers.filter(id => id !== user.id);
  user.activityLog.push({ action: 'block', targetId: target.id, timestamp: Date.now() });
  res.json({ message: `Blocked ${target.username}`, blocked: user.blocked.length });
});

// アンブロック
app.post('/unblock/:username', authenticateToken, (req, res) => {
  const target = users.find(u => u.username === req.params.username);
  if (!target) return res.status(404).json({ error: 'User not found' });

  const user = users.find(u => u.id === req.user.id);
  if (!user.blocked.includes(target.id)) return res.status(400).json({ error: 'Not blocked' });

  user.blocked = user.blocked.filter(id => id !== target.id);
  user.activityLog.push({ action: 'unblock', targetId: target.id, timestamp: Date.now() });
  res.json({ message: `Unblocked ${target.username}`, blocked: user.blocked.length });
});

// アカウントBAN（管理者専用）
app.post('/ban/:username', authenticateToken, requireAdmin, (req, res) => {
  const target = users.find(u => u.username === req.params.username);
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.id === req.user.id) return res.status(400).json({ error: 'Cannot ban yourself' });
  if (target.isAdmin) return res.status(400).json({ error: 'Cannot ban another admin' });

  target.isBanned = true;
  posts = posts.filter(p => p.userId !== target.id);
  res.json({ message: `${target.username} has been banned` });
});

// 投稿のピン留め（管理者専用）
app.post('/tweets/:id/pin', authenticateToken, requireAdmin, (req, res) => {
  const tweet = posts.find(t => t.id === Number(req.params.id));
  if (!tweet) return res.status(404).json({ error: 'Tweet not found' });
  if (tweet.userId !== req.user.id) return res.status(403).json({ error: 'Can only pin your own tweets' });

  posts.forEach(p => { if (p.userId === req.user.id && p.id !== tweet.id) p.pinned = false; });
  tweet.pinned = !tweet.pinned;
  res.json({ message: tweet.pinned ? 'Tweet pinned' : 'Tweet unpinned', tweet });
});

// 投稿の編集（管理者専用）
app.put('/tweets/:id', authenticateToken, requireAdmin, (req, res) => {
  const { content, image } = req.body;
  const tweet = posts.find(t => t.id === Number(req.params.id));
  if (!tweet) return res.status(404).json({ error: 'Tweet not found' });
  if (tweet.userId !== req.user.id) return res.status(403).json({ error: 'Can only edit your own tweets' });
  if (!content) return res.status(400).json({ error: 'Content required' });

  const hashtags = content.match(/#[^\s#]+/g)?.map(tag => tag.slice(1).toLowerCase()) || [];
  tweet.content = content;
  tweet.image = image || tweet.image;
  tweet.hashtags = hashtags;
  tweet.edited = true;
  tweet.editedAt = Date.now();
  res.json({ message: 'Tweet updated', tweet });
});

// 投稿の削除（管理者専用）
app.delete('/tweets/:id', authenticateToken, requireAdmin, (req, res) => {
  const tweet = posts.find(t => t.id === Number(req.params.id));
  if (!tweet) return res.status(404).json({ error: 'Tweet not found' });

  posts = posts.filter(p => p.id !== tweet.id);
  res.json({ message: 'Tweet deleted' });
});

// ユーザーへの警告（管理者専用）
app.post('/warn/:username', authenticateToken, requireAdmin, (req, res) => {
  const { message } = req.body;
  const target = users.find(u => u.username === req.params.username);
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.id === req.user.id) return res.status(400).json({ error: 'Cannot warn yourself' });
  if (!message) return res.status(400).json({ error: 'Warning message required' });

  notifications.push({
    id: notifications.length + 1,
    userId: target.id,
    type: 'warning',
    message: `Admin warning: ${message}`,
    timestamp: Date.now()
  });
  res.json({ message: `Warning sent to ${target.username}` });
});

// 全ユーザーへのアナウンス（管理者専用）
app.post('/announce', authenticateToken, requireAdmin, (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'Announcement message required' });

  users.forEach(user => {
    if (!user.isBanned) {
      notifications.push({
        id: notifications.length + 1,
        userId: user.id,
        type: 'announcement',
        message: `Admin announcement: ${message}`,
        timestamp: Date.now()
      });
    }
  });
  res.json({ message: 'Announcement sent to all users' });
});

// ユーザーアクティビティログ（管理者専用）
app.get('/users/:username/activity', authenticateToken, requireAdmin, (req, res) => {
  const target = users.find(u => u.username === req.params.username);
  if (!target) return res.status(404).json({ error: 'User not found' });

  res.json({ username: target.username, activityLog: target.activityLog.slice(0, 50) });
});

// ハッシュタグトレンド（管理者専用）
app.get('/trends/hashtags', authenticateToken, requireAdmin, (req, res) => {
  const hashtagCounts = {};
  posts.forEach(post => {
    post.hashtags.forEach(tag => {
      hashtagCounts[tag] = (hashtagCounts[tag] || 0) + 1;
    });
  });
  const trends = Object.entries(hashtagCounts)
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
  res.json({ trends });
});

// アナリティクス（フリーアカウント: 自分のデータ、管理者: 全データ）
app.get('/analytics', authenticateToken, (req, res) => {
  const user = users.find(u => u.id === req.user.id);
  const analytics = {};

  if (user.isAdmin) {
    const totalUsers = users.length;
    const totalPosts = posts.length;
    const totalImpressions = posts.reduce((sum, p) => sum + p.impressions, 0);
    const totalLikes = posts.reduce((sum, p) => sum + p.likes.length, 0);
    const totalRetweets = posts.reduce((sum, p) => sum + p.retweets.length, 0);
    const userStats = users.map(u => ({
      username: u.username,
      posts: posts.filter(p => p.userId === u.id).length,
      impressions: posts.filter(p => p.userId === u.id).reduce((sum, p) => sum + p.impressions, 0),
      likes: posts.filter(p => p.userId === u.id).reduce((sum, p) => sum + p.likes.length, 0),
      retweets: posts.filter(p => p.userId === u.id).reduce((sum, p) => sum + p.retweets.length, 0),
      followers: u.followers.length
    }));
    const hashtagStats = {};
    posts.forEach(post => {
      post.hashtags.forEach(tag => {
        hashtagStats[tag] = (hashtagStats[tag] || 0) + 1;
      });
    });
    const topHashtags = Object.entries(hashtagStats)
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    analytics.overview = { totalUsers, totalPosts, totalImpressions, totalLikes, totalRetweets };
    analytics.userStats = userStats;
    analytics.topHashtags = topHashtags;
  } else {
    const userPosts = posts.filter(p => p.userId === user.id);
    const totalImpressions = userPosts.reduce((sum, p) => sum + p.impressions, 0);
    const totalLikes = userPosts.reduce((sum, p) => sum + p.likes.length, 0);
    const totalRetweets = userPosts.reduce((sum, p) => sum + p.retweets.length, 0);
    const postStats = userPosts.map(p => ({
      id: p.id,
      content: p.content,
      impressions: p.impressions,
      likes: p.likes.length,
      retweets: p.retweets.length
    }));

    analytics.overview = { totalImpressions, totalLikes, totalRetweets };
    analytics.postStats = postStats;
  }

  res.json(analytics);
});

// 下書き保存
app.post('/drafts', authenticateToken, (req, res) => {
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: 'Content required' });

  const user = users.find(u => u.id === req.user.id);
  if (!user.isAdmin && content.length > 200) {
    return res.status(400).json({ error: 'Free accounts limited to 200 characters' });
  }

  user.draft = content;
  user.activityLog.push({ action: 'save_draft', timestamp: Date.now() });
  res.json({ message: 'Draft saved', draft: user.draft });
});

// 下書き取得
app.get('/drafts', authenticateToken, (req, res) => {
  const user = users.find(u => u.id === req.user.id);
  res.json({ draft: user.draft || null });
});

// プロフィール画像設定
app.post('/profile/image', authenticateToken, (req, res) => {
  const { image } = req.body;
  if (!image) return res.status(400).json({ error: 'Image required' });

  const user = users.find(u => u.id === req.user.id);
  user.profileImage = image;
  user.activityLog.push({ action: 'update_profile_image', timestamp: Date.now() });
  res.json({ message: 'Profile image updated', image: user.profileImage });
});

// プロフィール更新（bioとテーマカラー）
app.post('/profile/update', authenticateToken, (req, res) => {
  const { bio, themeColor } = req.body;
  const user = users.find(u => u.id === req.user.id);

  if (bio) user.bio = bio.slice(0, 160);
  if (themeColor) user.themeColor = themeColor;
  user.activityLog.push({ action: 'update_profile', timestamp: Date.now() });
  res.json({ message: 'Profile updated', bio: user.bio, themeColor: user.themeColor });
});

// 投稿検索（インプレッションカウント）
app.get('/search/tweets', authenticateToken, (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'Search query required' });

  const user = users.find(u => u.id === req.user.id);
  const results = posts
    .filter(p => p.content.toLowerCase().includes(q.toLowerCase()) && !user.blocked.includes(p.userId))
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 50);

  results.forEach(tweet => tweet.impressions += 1);
  res.json({ results });
});

// ハッシュタグ検索（インプレッションカウント）
app.get('/search/hashtags', authenticateToken, (req, res) => {
  const { tag } = req.query;
  if (!tag) return res.status(400).json({ error: 'Hashtag required' });

  const user = users.find(u => u.id === req.user.id);
  const results = posts
    .filter(p => p.hashtags.includes(tag.toLowerCase()) && !user.blocked.includes(p.userId))
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 50);

  results.forEach(tweet => tweet.impressions += 1);
  res.json({ results });
});

// ユーザープロフィール
app.get('/users/:username', authenticateToken, (req, res) => {
  const user = users.find(u => u.username === req.params.username);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.isBanned) return res.status(403).json({ error: 'User is banned' });

  const requester = users.find(u => u.id === req.user.id);
  if (requester.blocked.includes(user.id)) return res.status(403).json({ error: 'User blocked' });

  const userTweets = posts.filter(p => p.userId === user.id).sort((a, b) => b.timestamp - a.timestamp);
  res.json({
    username: user.username,
    following: user.following.length,
    followers: user.followers.length,
    tweets: userTweets.length,
    profileImage: user.profileImage,
    verified: user.verified ? 'blue_checkmark' : false,
    bio: user.bio,
    themeColor: user.themeColor,
    recent_tweets: userTweets.slice(0, 10),
  });
});

// 404ハンドリング（APIリクエスト用）
app.use((req, res) => {
  res.status(404).json({ error: 'Page not found' });
});

// サーバー起動と初期管理者設定
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

const initAdmin = async () => {
  if (!users.find(u => u.username === 'Hal')) {
    const hashedPassword = await bcrypt.hash('hayato0429', 10);
    users.push({
      id: 1,
      username: 'Hal',
      password: hashedPassword,
      following: [],
      followers: [],
      blocked: [],
      isAdmin: true,
      isBanned: false,
      draft: null,
      profileImage: null,
      verified: true,
      bio: 'Admin of this platform',
      themeColor: '#1DA1F2',
      activityLog: []
    });
    console.log('Admin user "Hal" created with password "hayato0429"');
  }
};
initAdmin();
