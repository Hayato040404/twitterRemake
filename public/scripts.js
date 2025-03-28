// 共通: トークンを取得
const getToken = () => localStorage.getItem('token');

// 共通: ログアウト
function logout() {
  localStorage.removeItem('token');
  window.location.href = '/';
}

// 共通: APIリクエスト用のヘッダー
const getHeaders = () => ({
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${getToken()}`
});

// 共通: 管理者かどうかを確認
function isAdmin() {
  const token = getToken();
  if (!token) return false;
  const decoded = JSON.parse(atob(token.split('.')[1]));
  return decoded.isAdmin;
}

// ナビゲーション: 管理者リンクの表示
if (isAdmin()) {
  const adminNavItem = document.getElementById('adminNavItem');
  if (adminNavItem) adminNavItem.style.display = 'block';
}

// 新規登録フォーム
const registerForm = document.getElementById('registerForm');
if (registerForm) {
  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const messageDiv = document.getElementById('message');

    try {
      console.log('新規登録リクエスト送信:', { username, password });
      const response = await fetch('/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await response.json();
      console.log('新規登録応答:', data);

      if (response.ok) {
        messageDiv.style.color = 'green';
        messageDiv.textContent = '登録成功！ログインしてください。';
        setTimeout(() => window.location.href = '/login.html', 2000);
      } else {
        messageDiv.style.color = 'red';
        messageDiv.textContent = data.error || '登録に失敗しました。';
      }
    } catch (error) {
      console.error('新規登録エラー:', error);
      messageDiv.style.color = 'red';
      messageDiv.textContent = 'エラーが発生しました。';
    }
  });
}

// ログインフォーム
const loginForm = document.getElementById('loginForm');
if (loginForm) {
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const messageDiv = document.getElementById('message');

    try {
      console.log('ログインリクエスト送信:', { username, password });
      const response = await fetch('/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await response.json();
      console.log('ログイン応答:', data);

      if (response.ok) {
        messageDiv.style.color = 'green';
        messageDiv.textContent = 'ログイン成功！';
        localStorage.setItem('token', data.token);
        console.log('トークン保存:', data.token);
        setTimeout(() => {
          console.log('リダイレクト実行');
          window.location.href = '/timeline.html';
        }, 2000);
      } else {
        messageDiv.style.color = 'red';
        messageDiv.textContent = data.error || 'ログインに失敗しました。';
      }
    } catch (error) {
      console.error('ログインエラー:', error);
      messageDiv.style.color = 'red';
      messageDiv.textContent = 'エラーが発生しました。';
    }
  });
}

// タイムライン: 投稿フォーム
const tweetForm = document.getElementById('tweetForm');
if (tweetForm) {
  tweetForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const content = document.getElementById('tweetContent').value;

    try {
      const response = await fetch('/tweets', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ content })
      });
      if (response.ok) {
        document.getElementById('tweetContent').value = '';
        loadFollowingTweets();
        loadRecommendedTweets();
      } else {
        const data = await response.json();
        alert(data.error || 'ツイートの投稿に失敗しました。');
      }
    } catch (error) {
      alert('エラーが発生しました。');
    }
  });

  // フォロー中のタイムラインを読み込み
  async function loadFollowingTweets() {
    try {
      const response = await fetch('/timeline/following', {
        headers: getHeaders()
      });
      const data = await response.json();
      if (response.ok) {
        const tweetsDiv = document.getElementById('followingTweets');
        tweetsDiv.innerHTML = '';
        data.tweets.forEach(tweet => {
          const tweetDiv = document.createElement('div');
          tweetDiv.className = `tweet ${tweet.pinned ? 'pinned' : ''}`;
          tweetDiv.innerHTML = `
            <div class="username">${tweet.username}</div>
            <div class="timestamp">${new Date(tweet.timestamp).toLocaleString()}</div>
            <div class="content">${tweet.content}</div>
            <div class="actions">
              <button onclick="likeTweet(${tweet.id}, this)">いいね (${tweet.likes.length})</button>
              <button onclick="retweet(${tweet.id})">リツイート (${tweet.retweets.length})</button>
              ${isAdmin() ? `<button onclick="deleteTweet(${tweet.id})" class="text-danger">削除</button>` : ''}
              ${isAdmin() ? `<button onclick="pinTweet(${tweet.id})">${tweet.pinned ? 'ピン解除' : 'ピン留め'}</button>` : ''}
            </div>
          `;
          tweetsDiv.appendChild(tweetDiv);
        });
      } else {
        alert(data.error || 'タイムラインの読み込みに失敗しました。');
      }
    } catch (error) {
      alert('エラーが発生しました。');
    }
  }

  // おすすめタイムラインを読み込み
  async function loadRecommendedTweets() {
    try {
      const response = await fetch('/timeline/recommended', {
        headers: getHeaders()
      });
      const data = await response.json();
      if (response.ok) {
        const tweetsDiv = document.getElementById('recommendedTweets');
        tweetsDiv.innerHTML = '';
        data.tweets.forEach(tweet => {
          const tweetDiv = document.createElement('div');
          tweetDiv.className = `tweet ${tweet.pinned ? 'pinned' : ''}`;
          tweetDiv.innerHTML = `
            <div class="username">${tweet.username}</div>
            <div class="timestamp">${new Date(tweet.timestamp).toLocaleString()}</div>
            <div class="content">${tweet.content}</div>
            <div class="actions">
              <button onclick="likeTweet(${tweet.id}, this)">いいね (${tweet.likes.length})</button>
              <button onclick="retweet(${tweet.id})">リツイート (${tweet.retweets.length})</button>
              ${isAdmin() ? `<button onclick="deleteTweet(${tweet.id})" class="text-danger">削除</button>` : ''}
              ${isAdmin() ? `<button onclick="pinTweet(${tweet.id})">${tweet.pinned ? 'ピン解除' : 'ピン留め'}</button>` : ''}
            </div>
          `;
          tweetsDiv.appendChild(tweetDiv);
        });
      } else {
        alert(data.error || 'おすすめタイムラインの読み込みに失敗しました。');
      }
    } catch (error) {
      alert('エラーが発生しました。');
    }
  }

  // いいね機能
  window.likeTweet = async (tweetId, button) => {
    try {
      const response = await fetch(`/tweets/${tweetId}/like`, {
        method: 'POST',
        headers: getHeaders()
      });
      const data = await response.json();
      if (response.ok) {
        button.textContent = `いいね (${data.likes_count})`;
      } else {
        alert(data.error || 'いいねに失敗しました。');
      }
    } catch (error) {
      alert('エラーが発生しました。');
    }
  };

  // リツイート機能
  window.retweet = async (tweetId) => {
    try {
      const response = await fetch(`/tweets/${tweetId}/retweet`, {
        method: 'POST',
        headers: getHeaders()
      });
      if (response.ok) {
        loadFollowingTweets();
        loadRecommendedTweets();
      } else {
        const data = await response.json();
        alert(data.error || 'リツイートに失敗しました。');
      }
    } catch (error) {
      alert('エラーが発生しました。');
    }
  };

  // 投稿削除機能（管理者専用）
  window.deleteTweet = async (tweetId) => {
    if (!isAdmin()) return;
    try {
      const response = await fetch(`/tweets/${tweetId}`, {
        method: 'DELETE',
        headers: getHeaders()
      });
      if (response.ok) {
        loadFollowingTweets();
        loadRecommendedTweets();
      } else {
        const data = await response.json();
        alert(data.error || '投稿の削除に失敗しました。');
      }
    } catch (error) {
      alert('エラーが発生しました。');
    }
  };

  // 投稿ピン留め機能（管理者専用）
  window.pinTweet = async (tweetId) => {
    if (!isAdmin()) return;
    try {
      const response = await fetch(`/tweets/${tweetId}/pin`, {
        method: 'POST',
        headers: getHeaders()
      });
      if (response.ok) {
        loadFollowingTweets();
        loadRecommendedTweets();
      } else {
        const data = await response.json();
        alert(data.error || 'ピン留めに失敗しました。');
      }
    } catch (error) {
      alert('エラーが発生しました。');
    }
  };

  // 初回読み込み
  loadFollowingTweets();
  loadRecommendedTweets();
}

// プロフィールページ
if (window.location.pathname === '/profile.html') {
  async function loadProfile() {
    try {
      const token = getToken();
      const decoded = JSON.parse(atob(token.split('.')[1]));
      const username = decoded.username;

      const response = await fetch(`/users/${username}`, {
        headers: getHeaders()
      });
      const data = await response.json();
      if (response.ok) {
        document.getElementById('profileUsername').textContent = data.username;
        document.getElementById('profileBio').textContent = data.bio || '自己紹介がありません。';
        document.getElementById('followingCount').textContent = data.following;
        document.getElementById('followersCount').textContent = data.followers;
        if (data.profileImage) {
          document.getElementById('profileImage').src = data.profileImage;
          document.getElementById('profileImage').style.display = 'block';
        }
        if (data.verified) {
          document.getElementById('verifiedBadge').style.display = 'inline';
        }

        const tweetsDiv = document.getElementById('userTweets');
        tweetsDiv.innerHTML = '';
        data.recent_tweets.forEach(tweet => {
          const tweetDiv = document.createElement('div');
          tweetDiv.className = `tweet ${tweet.pinned ? 'pinned' : ''}`;
          tweetDiv.innerHTML = `
            <div class="username">${tweet.username}</div>
            <div class="timestamp">${new Date(tweet.timestamp).toLocaleString()}</div>
            <div class="content">${tweet.content}</div>
            <div class="actions">
              <button onclick="likeTweet(${tweet.id}, this)">いいね (${tweet.likes.length})</button>
              <button onclick="retweet(${tweet.id})">リツイート (${tweet.retweets.length})</button>
              ${isAdmin() ? `<button onclick="deleteTweet(${tweet.id})" class="text-danger">削除</button>` : ''}
              ${isAdmin() ? `<button onclick="pinTweet(${tweet.id})">${tweet.pinned ? 'ピン解除' : 'ピン留め'}</button>` : ''}
            </div>
          `;
          tweetsDiv.appendChild(tweetDiv);
        });
      } else {
        alert(data.error || 'プロフィールの読み込みに失敗しました。');
      }
    } catch (error) {
      alert('エラーが発生しました。');
    }
  }

  // プロフィール編集
  const editProfileForm = document.getElementById('editProfileForm');
  if (editProfileForm) {
    editProfileForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const bio = document.getElementById('editBio').value;
      const themeColor = document.getElementById('editThemeColor').value;

      try {
        const response = await fetch('/profile/update', {
          method: 'POST',
          headers: getHeaders(),
          body: JSON.stringify({ bio, themeColor })
        });
        if (response.ok) {
          loadProfile();
          bootstrap.Modal.getInstance(document.getElementById('editProfileModal')).hide();
        } else {
          const data = await response.json();
          alert(data.error || 'プロフィールの更新に失敗しました。');
        }
      } catch (error) {
        alert('エラーが発生しました。');
      }
    });
  }

  loadProfile();
}

// 通知ページ
if (window.location.pathname === '/notifications.html') {
  async function loadNotifications() {
    try {
      const response = await fetch('/notifications', {
        headers: getHeaders()
      });
      const data = await response.json();
      if (response.ok) {
        const notificationsDiv = document.getElementById('notificationsList');
        notificationsDiv.innerHTML = '';
        data.notifications.forEach(notification => {
          const notifDiv = document.createElement('div');
          notifDiv.className = 'notification';
          notifDiv.innerHTML = `
            <p class="message">${notification.message}</p>
            <div class="timestamp">${new Date(notification.timestamp).toLocaleString()}</div>
          `;
          notificationsDiv.appendChild(notifDiv);
        });
      } else {
        alert(data.error || '通知の読み込みに失敗しました。');
      }
    } catch (error) {
      alert('エラーが発生しました。');
    }
  }

  loadNotifications();
}

// アナリティクスページ
if (window.location.pathname === '/analytics.html') {
  async function loadAnalytics() {
    try {
      const response = await fetch('/analytics', {
        headers: getHeaders()
      });
      const data = await response.json();
      if (response.ok) {
        document.getElementById('totalImpressions').textContent = data.overview.totalImpressions;
        document.getElementById('totalLikes').textContent = data.overview.totalLikes;
        document.getElementById('totalRetweets').textContent = data.overview.totalRetweets;

        if (data.postStats) {
          const postStatsDiv = document.getElementById('postStats');
          postStatsDiv.innerHTML = '<h5>投稿ごとの統計</h5>';
          data.postStats.forEach(stat => {
            const statDiv = document.createElement('div');
            statDiv.className = 'card mb-2';
            statDiv.innerHTML = `
              <div class="card-body">
                <p>${stat.content}</p>
                <p>インプレッション: ${stat.impressions}</p>
                <p>いいね: ${stat.likes}</p>
                <p>リツイート: ${stat.retweets}</p>
              </div>
            `;
            postStatsDiv.appendChild(statDiv);
          });
        }

        if (data.userStats) {
          const adminStatsDiv = document.getElementById('adminStats');
          adminStatsDiv.innerHTML = '<h5>ユーザー統計</h5>';
          data.userStats.forEach(user => {
            const userDiv = document.createElement('div');
            userDiv.className = 'card mb-2';
            userDiv.innerHTML = `
              <div class="card-body">
                <h6>${user.username}</h6>
                <p>投稿数: ${user.posts}</p>
                <p>インプレッション: ${user.impressions}</p>
                <p>いいね: ${user.likes}</p>
                <p>リツイート: ${user.retweets}</p>
                <p>フォロワー: ${user.followers}</p>
              </div>
            `;
            adminStatsDiv.appendChild(userDiv);
          });

          adminStatsDiv.innerHTML += '<h5>人気ハッシュタグ</h5>';
          data.topHashtags.forEach(tag => {
            const tagDiv = document.createElement('div');
            tagDiv.className = 'card mb-2';
            tagDiv.innerHTML = `
              <div class="card-body">
                <p>#${tag.tag}: ${tag.count} 回</p>
              </div>
            `;
            adminStatsDiv.appendChild(tagDiv);
          });
        }
      } else {
        alert(data.error || 'アナリティクスの読み込みに失敗しました。');
      }
    } catch (error) {
      alert('エラーが発生しました。');
    }
  }

  loadAnalytics();
}

// 管理者ダッシュボード
if (window.location.pathname === '/admin.html') {
  if (!isAdmin()) {
    alert('管理者権限が必要です。');
    window.location.href = '/timeline.html';
    // return を削除
  }

  // ユーザーBAN
  const banUserForm = document.getElementById('banUserForm');
  if (banUserForm) {
    banUserForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = document.getElementById('banUsername').value;

      try {
        const response = await fetch(`/ban/${username}`, {
          method: 'POST',
          headers: getHeaders()
        });
        const data = await response.json();
        if (response.ok) {
          alert(data.message);
          document.getElementById('banUsername').value = '';
        } else {
          alert(data.error || 'ユーザーBANに失敗しました。');
        }
      } catch (error) {
        alert('エラーが発生しました。');
      }
    });
  }

  // ユーザーへの警告
  const warnUserForm = document.getElementById('warnUserForm');
  if (warnUserForm) {
    warnUserForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = document.getElementById('warnUsername').value;
      const message = document.getElementById('warnMessage').value;

      try {
        const response = await fetch(`/warn/${username}`, {
          method: 'POST',
          headers: getHeaders(),
          body: JSON.stringify({ message })
        });
        const data = await response.json();
        if (response.ok) {
          alert(data.message);
          document.getElementById('warnUsername').value = '';
          document.getElementById('warnMessage').value = '';
        } else {
          alert(data.error || '警告の送信に失敗しました。');
        }
      } catch (error) {
        alert('エラーが発生しました。');
      }
    });
  }

  // 全ユーザーへのアナウンス
  const announceForm = document.getElementById('announceForm');
  if (announceForm) {
    announceForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const message = document.getElementById('announceMessage').value;

      try {
        const response = await fetch('/announce', {
          method: 'POST',
          headers: getHeaders(),
          body: JSON.stringify({ message })
        });
        const data = await response.json();
        if (response.ok) {
          alert(data.message);
          document.getElementById('announceMessage').value = '';
        } else {
          alert(data.error || 'アナウンスの送信に失敗しました。');
        }
      } catch (error) {
        alert('エラーが発生しました。');
      }
    });
  }

  // ユーザーアクティビティログ
  const activityLogForm = document.getElementById('activityLogForm');
  if (activityLogForm) {
    activityLogForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = document.getElementById('activityUsername').value;

      try {
        const response = await fetch(`/users/${username}/activity`, {
          headers: getHeaders()
        });
        const data = await response.json();
        if (response.ok) {
          const logDiv = document.getElementById('activityLog');
          logDiv.innerHTML = '';
          data.activityLog.forEach(log => {
            const logEntry = document.createElement('div');
            logEntry.className = 'activity-log';
            logEntry.innerHTML = `
              <p class="action">${log.action}</p>
              <div class="timestamp">${new Date(log.timestamp).toLocaleString()}</div>
            `;
            logDiv.appendChild(logEntry);
          });
        } else {
          alert(data.error || 'アクティビティログの取得に失敗しました。');
        }
      } catch (error) {
        alert('エラーが発生しました。');
      }
    });
  }

  // ハッシュタグトレンド
  async function loadHashtagTrends() {
    try {
      const response = await fetch('/trends/hashtags', {
        headers: getHeaders()
      });
      const data = await response.json();
      if (response.ok) {
        const trendsDiv = document.getElementById('hashtagTrends');
        trendsDiv.innerHTML = '';
        data.trends.forEach(trend => {
          const trendDiv = document.createElement('div');
          trendDiv.className = 'card mb-2';
          trendDiv.innerHTML = `
            <div class="card-body">
              <p>#${trend.tag}: ${trend.count} 回</p>
            </div>
          `;
          trendsDiv.appendChild(trendDiv);
        });
      } else {
        alert(data.error || 'ハッシュタグトレンドの取得に失敗しました。');
      }
    } catch (error) {
      alert('エラーが発生しました。');
    }
  }

  loadHashtagTrends();
}
