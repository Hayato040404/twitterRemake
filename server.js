// トークン管理
function getToken() {
  return localStorage.getItem('token');
}

function setToken(token) {
  localStorage.setItem('token', token);
}

function removeToken() {
  localStorage.removeItem('token');
}

function getHeaders() {
  return {
    'Authorization': `Bearer ${getToken()}`,
    'Content-Type': 'application/json'
  };
}

function getCurrentUsername() {
  const token = getToken();
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.username;
  } catch (e) {
    console.error('トークンのデコードに失敗しました:', e);
    return null;
  }
}

function isAdmin() {
  const token = getToken();
  if (!token) return false;
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.isAdmin || false;
  } catch (e) {
    console.error('トークンのデコードに失敗しました:', e);
    return false;
  }
}

// ログインページ
if (window.location.pathname === '/login.html') {
  document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;

    try {
      const response = await fetch('/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ username, password })
      });
      const data = await response.json();
      if (response.ok) {
        setToken(data.token);
        window.location.href = 'index.html';
      } else {
        alert(data.error || 'ログインに失敗しました。');
      }
    } catch (error) {
      console.error('ログインエラー:', error);
      alert('エラーが発生しました。');
    }
  });
}

// 新規登録ページ
if (window.location.pathname === '/register.html') {
  document.getElementById('registerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;

    try {
      const response = await fetch('/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ username, password })
      });
      const data = await response.json();
      if (response.ok) {
        alert('登録が完了しました！ログインしてください。');
        window.location.href = 'login.html';
      } else {
        alert(data.error || '登録に失敗しました。');
      }
    } catch (error) {
      console.error('新規登録エラー:', error);
      alert('エラーが発生しました。');
    }
  });
}

// ログアウト
function logout() {
  removeToken();
  window.location.href = 'login.html';
}

// 未読通知数の更新
async function updateUnreadBadge() {
  try {
    const response = await fetch('/notifications/unread', {
      headers: getHeaders()
    });
    const data = await response.json();
    if (response.ok) {
      const badge = document.getElementById('unreadBadge');
      if (data.unreadCount > 0) {
        badge.textContent = data.unreadCount;
        badge.style.display = 'inline';
      } else {
        badge.style.display = 'none';
      }
    } else {
      console.error('未読通知数の取得に失敗しました:', data.error);
    }
  } catch (error) {
    console.error('未読通知数の取得エラー:', error);
  }
}

// プロフィールページに遷移
window.goToProfile = (username) => {
  window.location.href = `profile.html?username=${username}`;
};

// ツイート投稿
async function postTweet(event) {
  event.preventDefault();
  const content = document.getElementById('tweetContent').value;

  try {
    const response = await fetch('/tweets', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ content })
    });
    const data = await response.json();
    if (response.ok) {
      document.getElementById('tweetContent').value = '';
      loadTimeline();
    } else {
      alert(data.error || 'ツイートの投稿に失敗しました。');
    }
  } catch (error) {
    console.error('ツイート投稿エラー:', error);
    alert('エラーが発生しました。');
  }
}

// いいね
window.likeTweet = async (tweetId, button) => {
  try {
    const response = await fetch(`/tweets/${tweetId}/like`, {
      method: 'POST',
      headers: getHeaders()
    });
    const data = await response.json();
    if (response.ok) {
      button.textContent = `いいね (${data.likes_count})`;
      updateUnreadBadge();
    } else {
      alert(data.error || 'いいねに失敗しました。');
    }
  } catch (error) {
    console.error('いいねエラー:', error);
    alert('エラーが発生しました。');
  }
};

// リツイート
window.retweet = async (tweetId) => {
  try {
    const response = await fetch(`/tweets/${tweetId}/retweet`, {
      method: 'POST',
      headers: getHeaders()
    });
    const data = await response.json();
    if (response.ok) {
      loadTimeline();
      updateUnreadBadge();
    } else {
      alert(data.error || 'リツイートに失敗しました。');
    }
  } catch (error) {
    console.error('リツイートエラー:', error);
    alert('エラーが発生しました。');
  }
};

// 返信フォームの表示/非表示
window.toggleReplyForm = (tweetId) => {
  const replyForm = document.getElementById(`replyForm-${tweetId}`);
  replyForm.style.display = replyForm.style.display === 'none' ? 'block' : 'none';
};

// 返信投稿
window.submitReply = async (event, tweetId) => {
  event.preventDefault();
  const content = document.getElementById(`replyContent-${tweetId}`).value;

  try {
    const response = await fetch(`/tweets/${tweetId}/reply`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ content })
    });
    const data = await response.json();
    if (response.ok) {
      document.getElementById(`replyContent-${tweetId}`).value = '';
      loadTimeline();
      updateUnreadBadge();
    } else {
      alert(data.error || '返信の投稿に失敗しました。');
    }
  } catch (error) {
    console.error('返信エラー:', error);
    alert('エラーが発生しました。');
  }
};

// ツイート削除（管理者専用）
window.deleteTweet = async (tweetId) => {
  if (confirm('このツイートを削除しますか？')) {
    try {
      const response = await fetch(`/tweets/${tweetId}`, {
        method: 'DELETE',
        headers: getHeaders()
      });
      const data = await response.json();
      if (response.ok) {
        loadTimeline();
      } else {
        alert(data.error || 'ツイートの削除に失敗しました。');
      }
    } catch (error) {
      console.error('ツイート削除エラー:', error);
      alert('エラーが発生しました。');
    }
  }
};

// ツイートピン留め（管理者専用）
window.pinTweet = async (tweetId) => {
  try {
    const response = await fetch(`/tweets/${tweetId}/pin`, {
      method: 'POST',
      headers: getHeaders()
    });
    const data = await response.json();
    if (response.ok) {
      loadTimeline();
    } else {
      alert(data.error || 'ピン留めに失敗しました。');
    }
  } catch (error) {
    console.error('ピン留めエラー:', error);
    alert('エラーが発生しました。');
  }
};

// タイムラインページ
if (window.location.pathname === '/index.html') {
  async function loadTimeline() {
    try {
      const response = await fetch('/timeline/following', {
        headers: getHeaders()
      });
      const data = await response.json();
      if (response.ok) {
        const tweetsDiv = document.getElementById('tweets');
        tweetsDiv.innerHTML = '';
        data.tweets.forEach(tweet => {
          const tweetDiv = document.createElement('div');
          tweetDiv.className = `tweet ${tweet.pinned ? 'pinned' : ''}`;
          tweetDiv.innerHTML = `
            <div class="username" onclick="goToProfile('${tweet.username}')">${tweet.username}</div>
            <div class="timestamp">${new Date(tweet.timestamp).toLocaleString()}</div>
            <div class="content">${tweet.content}</div>
            <div class="actions">
              <button onclick="likeTweet(${tweet.id}, this)">いいね (${tweet.likes.length})</button>
              <button onclick="retweet(${tweet.id})">リツイート (${tweet.retweets.length})</button>
              <button onclick="toggleReplyForm(${tweet.id})">返信 (${tweet.replies ? tweet.replies.length : 0})</button>
              ${isAdmin() ? `<button onclick="deleteTweet(${tweet.id})" class="text-danger">削除</button>` : ''}
              ${isAdmin() ? `<button onclick="pinTweet(${tweet.id})">${tweet.pinned ? 'ピン解除' : 'ピン留め'}</button>` : ''}
            </div>
            <div class="reply-form" id="replyForm-${tweet.id}" style="display: none;">
              <form onsubmit="submitReply(event, ${tweet.id})">
                <div class="mb-3">
                  <textarea class="form-control" id="replyContent-${tweet.id}" rows="2" placeholder="返信を入力..." required></textarea>
                </div>
                <button type="submit" class="btn btn-primary btn-sm">返信</button>
              </form>
            </div>
            <div class="replies" id="replies-${tweet.id}"></div>
          `;
          tweetsDiv.appendChild(tweetDiv);

          if (tweet.replies && tweet.replies.length > 0) {
            const repliesDiv = document.getElementById(`replies-${tweet.id}`);
            tweet.replies.forEach(reply => {
              const replyDiv = document.createElement('div');
              replyDiv.className = 'reply';
              replyDiv.innerHTML = `
                <div class="username" onclick="goToProfile('${reply.username}')">${reply.username}</div>
                <div class="timestamp">${new Date(reply.timestamp).toLocaleString()}</div>
                <div class="content">${reply.content}</div>
              `;
              repliesDiv.appendChild(replyDiv);
            });
          }
        });
      } else {
        alert(data.error || 'タイムラインの読み込みに失敗しました。');
      }
    } catch (error) {
      console.error('タイムライン読み込みエラー:', error);
      alert('エラーが発生しました。');
    }
  }

  document.getElementById('tweetForm').addEventListener('submit', postTweet);
  loadTimeline();
  updateUnreadBadge();
}

// おすすめページ
if (window.location.pathname === '/recommended.html') {
  async function loadRecommended() {
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
            <div class="username" onclick="goToProfile('${tweet.username}')">${tweet.username}</div>
            <div class="timestamp">${new Date(tweet.timestamp).toLocaleString()}</div>
            <div class="content">${tweet.content}</div>
            <div class="actions">
              <button onclick="likeTweet(${tweet.id}, this)">いいね (${tweet.likes.length})</button>
              <button onclick="retweet(${tweet.id})">リツイート (${tweet.retweets.length})</button>
              <button onclick="toggleReplyForm(${tweet.id})">返信 (${tweet.replies ? tweet.replies.length : 0})</button>
              ${isAdmin() ? `<button onclick="deleteTweet(${tweet.id})" class="text-danger">削除</button>` : ''}
              ${isAdmin() ? `<button onclick="pinTweet(${tweet.id})">${tweet.pinned ? 'ピン解除' : 'ピン留め'}</button>` : ''}
            </div>
            <div class="reply-form" id="replyForm-${tweet.id}" style="display: none;">
              <form onsubmit="submitReply(event, ${tweet.id})">
                <div class="mb-3">
                  <textarea class="form-control" id="replyContent-${tweet.id}" rows="2" placeholder="返信を入力..." required></textarea>
                </div>
                <button type="submit" class="btn btn-primary btn-sm">返信</button>
              </form>
            </div>
            <div class="replies" id="replies-${tweet.id}"></div>
          `;
          tweetsDiv.appendChild(tweetDiv);

          if (tweet.replies && tweet.replies.length > 0) {
            const repliesDiv = document.getElementById(`replies-${tweet.id}`);
            tweet.replies.forEach(reply => {
              const replyDiv = document.createElement('div');
              replyDiv.className = 'reply';
              replyDiv.innerHTML = `
                <div class="username" onclick="goToProfile('${reply.username}')">${reply.username}</div>
                <div class="timestamp">${new Date(reply.timestamp).toLocaleString()}</div>
                <div class="content">${reply.content}</div>
              `;
              repliesDiv.appendChild(replyDiv);
            });
          }
        });
      } else {
        alert(data.error || 'おすすめの読み込みに失敗しました。');
      }
    } catch (error) {
      console.error('おすすめ読み込みエラー:', error);
      alert('エラーが発生しました。');
    }
  }

  loadRecommended();
  updateUnreadBadge();
}

// プロフィールページ
if (window.location.pathname === '/profile.html') {
  async function loadProfile() {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const targetUsername = urlParams.get('username') || getCurrentUsername();

      console.log(`プロフィール取得: ユーザー名=${targetUsername}`);
      const response = await fetch(`/users/${targetUsername}`, {
        headers: getHeaders()
      });
      const data = await response.json();
      console.log('プロフィールデータ:', data);

      if (response.ok) {
        document.getElementById('profileUsername').textContent = data.username;
        document.getElementById('profileBio').textContent = data.bio || '自己紹介がありません。';
        document.getElementById('followingCount').textContent = data.followingCount;
        document.getElementById('followersCount').textContent = data.followersCount;
        if (data.profileImage) {
          document.getElementById('profileImage').src = data.profileImage;
          document.getElementById('profileImage').style.display = 'block';
        }
        if (data.verified) {
          document.getElementById('verifiedBadge').style.display = 'inline';
        }

        // フォロー/アンフォローボタンの表示
        const currentUser = getCurrentUsername();
        const followButtonContainer = document.getElementById('followButtonContainer');
        if (currentUser !== targetUsername) {
          const isFollowing = Array.isArray(data.followers) && data.followers.includes(currentUser);
          console.log(`フォロー状態: ${currentUser}が${targetUsername}をフォロー中=${isFollowing}`);
          followButtonContainer.innerHTML = `
            <button class="btn ${isFollowing ? 'btn-outline-secondary' : 'btn-primary'}" onclick="toggleFollow('${targetUsername}', ${isFollowing})">
              ${isFollowing ? 'アンフォロー' : 'フォロー'}
            </button>
          `;
        } else {
          document.getElementById('editProfileButton').style.display = 'block';
        }

        const tweetsDiv = document.getElementById('userTweets');
        tweetsDiv.innerHTML = '';
        data.recent_tweets.forEach(tweet => {
          const tweetDiv = document.createElement('div');
          tweetDiv.className = `tweet ${tweet.pinned ? 'pinned' : ''}`;
          tweetDiv.innerHTML = `
            <div class="username" onclick="goToProfile('${tweet.username}')">${tweet.username}</div>
            <div class="timestamp">${new Date(tweet.timestamp).toLocaleString()}</div>
            <div class="content">${tweet.content}</div>
            <div class="actions">
              <button onclick="likeTweet(${tweet.id}, this)">いいね (${tweet.likes.length})</button>
              <button onclick="retweet(${tweet.id})">リツイート (${tweet.retweets.length})</button>
              <button onclick="toggleReplyForm(${tweet.id})">返信 (${tweet.replies ? tweet.replies.length : 0})</button>
              ${isAdmin() ? `<button onclick="deleteTweet(${tweet.id})" class="text-danger">削除</button>` : ''}
              ${isAdmin() ? `<button onclick="pinTweet(${tweet.id})">${tweet.pinned ? 'ピン解除' : 'ピン留め'}</button>` : ''}
            </div>
            <div class="reply-form" id="replyForm-${tweet.id}" style="display: none;">
              <form onsubmit="submitReply(event, ${tweet.id})">
                <div class="mb-3">
                  <textarea class="form-control" id="replyContent-${tweet.id}" rows="2" placeholder="返信を入力..." required></textarea>
                </div>
                <button type="submit" class="btn btn-primary btn-sm">返信</button>
              </form>
            </div>
            <div class="replies" id="replies-${tweet.id}"></div>
          `;
          tweetsDiv.appendChild(tweetDiv);

          if (tweet.replies && tweet.replies.length > 0) {
            const repliesDiv = document.getElementById(`replies-${tweet.id}`);
            tweet.replies.forEach(reply => {
              const replyDiv = document.createElement('div');
              replyDiv.className = 'reply';
              replyDiv.innerHTML = `
                <div class="username" onclick="goToProfile('${reply.username}')">${reply.username}</div>
                <div class="timestamp">${new Date(reply.timestamp).toLocaleString()}</div>
                <div class="content">${reply.content}</div>
              `;
              repliesDiv.appendChild(replyDiv);
            });
          }
        });
      } else {
        console.error('プロフィール取得エラー:', data.error);
        alert(data.error || 'プロフィールの読み込みに失敗しました。');
      }
    } catch (error) {
      console.error('プロフィール読み込みエラー:', error);
      alert('エラーが発生しました。詳細はコンソールを確認してください。');
    }
  }

  window.toggleFollow = async (username, isFollowing) => {
    try {
      const endpoint = isFollowing ? `/unfollow/${username}` : `/follow/${username}`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: getHeaders()
      });
      const data = await response.json();
      if (response.ok) {
        loadProfile();
        updateUnreadBadge();
      } else {
        alert(data.error || 'フォロー/アンフォローに失敗しました。');
      }
    } catch (error) {
      console.error('フォロー/アンフォローエラー:', error);
      alert('エラーが発生しました。');
    }
  };

  const editProfileForm = document.getElementById('editProfileForm');
  if (editProfileForm) {
    editProfileForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const bio = document 🙂

.getElementById('editBio').value;
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
        console.error('プロフィール更新エラー:', error);
        alert('エラーが発生しました。');
      }
    });
  }

  loadProfile();
  updateUnreadBadge();
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
        const notificationsDiv = document.getElementById('notifications');
        notificationsDiv.innerHTML = '';
        data.notifications.forEach(notification => {
          const notificationDiv = document.createElement('div');
          notificationDiv.className = `notification ${notification.read ? 'read' : 'unread'}`;
          notificationDiv.innerHTML = `
            <div class="message">${notification.message}</div>
            <div class="timestamp">${new Date(notification.timestamp).toLocaleString()}</div>
          `;
          notificationsDiv.appendChild(notificationDiv);
        });
      } else {
        alert(data.error || '通知の読み込みに失敗しました。');
      }
    } catch (error) {
      console.error('通知読み込みエラー:', error);
      alert('エラーが発生しました。');
    }
  }

  loadNotifications();
  updateUnreadBadge();
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

        const postStatsDiv = document.getElementById('postStats');
        postStatsDiv.innerHTML = '';
        data.postStats.forEach(stat => {
          const statDiv = document.createElement('div');
          statDiv.className = 'post-stat';
          statDiv.innerHTML = `
            <div class="content">${stat.content}</div>
            <div>インプレッション: ${stat.impressions}</div>
            <div>いいね: ${stat.likes}</div>
            <div>リツイート: ${stat.retweets}</div>
          `;
          postStatsDiv.appendChild(statDiv);
        });

        if (isAdmin()) {
          document.getElementById('adminStats').style.display = 'block';

          const userStatsDiv = document.getElementById('userStats');
          userStatsDiv.innerHTML = '';
          data.userStats.forEach(stat => {
            const statDiv = document.createElement('div');
            statDiv.className = 'user-stat';
            statDiv.innerHTML = `
              <div>ユーザー名: ${stat.username}</div>
              <div>投稿数: ${stat.posts}</div>
              <div>インプレッション: ${stat.impressions}</div>
              <div>いいね: ${stat.likes}</div>
              <div>リツイート: ${stat.retweets}</div>
              <div>フォロワー: ${stat.followers}</div>
            `;
            userStatsDiv.appendChild(statDiv);
          });

          const topHashtagsDiv = document.getElementById('topHashtags');
          topHashtagsDiv.innerHTML = '';
          data.topHashtags.forEach(hashtag => {
            const hashtagDiv = document.createElement('div');
            hashtagDiv.className = 'hashtag';
            hashtagDiv.innerHTML = `
              <div>#${hashtag.tag}: ${hashtag.count} 回</div>
            `;
            topHashtagsDiv.appendChild(hashtagDiv);
          });
        }
      } else {
        alert(data.error || 'アナリティクスの読み込みに失敗しました。');
      }
    } catch (error) {
      console.error('アナリティクス読み込みエラー:', error);
      alert('エラーが発生しました。');
    }
  }

  loadAnalytics();
  updateUnreadBadge();
}

// 管理者ページ
if (window.location.pathname === '/admin.html') {
  async function loadUserActivity(username) {
    try {
      const response = await fetch(`/users/${username}/activity`, {
        headers: getHeaders()
      });
      const data = await response.json();
      if (response.ok) {
        const activityDiv = document.getElementById('userActivity');
        activityDiv.innerHTML = '';
        data.activityLog.forEach(log => {
          const logDiv = document.createElement('div');
          logDiv.className = 'activity-log';
          logDiv.innerHTML = `
            <div>${log.username} が ${log.action} (${new Date(log.timestamp).toLocaleString()})</div>
          `;
          activityDiv.appendChild(logDiv);
        });
      } else {
        alert(data.error || 'アクティビティの読み込みに失敗しました。');
      }
    } catch (error) {
      console.error('アクティビティ読み込みエラー:', error);
      alert('エラーが発生しました。');
    }
  }

  async function loadTrends() {
    try {
      const response = await fetch('/trends/hashtags', {
        headers: getHeaders()
      });
      const data = await response.json();
      if (response.ok) {
        const trendsDiv = document.getElementById('trends');
        trendsDiv.innerHTML = '';
        data.trends.forEach(trend => {
          const trendDiv = document.createElement('div');
          trendDiv.className = 'trend';
          trendDiv.innerHTML = `
            <div>#${trend.tag}: ${trend.count} 回</div>
          `;
          trendsDiv.appendChild(trendDiv);
        });
      } else {
        alert(data.error || 'トレンドの読み込みに失敗しました。');
      }
    } catch (error) {
      console.error('トレンド読み込みエラー:', error);
      alert('エラーが発生しました。');
    }
  }

  document.getElementById('banUserForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('banUsername').value;

    try {
      const response = await fetch(`/ban/${username}`, {
        method: 'POST',
        headers: getHeaders()
      });
      const data = await response.json();
      if (response.ok) {
        alert(`${username} をBANしました。`);
      } else {
        alert(data.error || 'BANに失敗しました。');
      }
    } catch (error) {
      console.error('BANエラー:', error);
      alert('エラーが発生しました。');
    }
  });

  document.getElementById('warnUserForm').addEventListener('submit', async (e) => {
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
        alert(`${username} に警告を送信しました。`);
      } else {
        alert(data.error || '警告の送信に失敗しました。');
      }
    } catch (error) {
      console.error('警告送信エラー:', error);
      alert('エラーが発生しました。');
    }
  });

  document.getElementById('announceForm').addEventListener('submit', async (e) => {
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
        alert('アナウンスを送信しました。');
      } else {
        alert(data.error || 'アナウンスの送信に失敗しました。');
      }
    } catch (error) {
      console.error('アナウンス送信エラー:', error);
      alert('エラーが発生しました。');
    }
  });

  document.getElementById('loadActivityForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const username = document.getElementById('activityUsername').value;
    loadUserActivity(username);
  });

  loadTrends();
  updateUnreadBadge();
}
