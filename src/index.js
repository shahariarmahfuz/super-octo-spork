// ১. অ্যাডমিন পাসওয়ার্ড
const ADMIN_PASSWORD = "12345"; 

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // ================================================================
    // ১. প্লেলিস্ট জেনারেটর (Playlist M3U)
    // লিংক: https://your-worker.dev/playlist.m3u
    // ================================================================
    if (url.pathname === '/playlist.m3u') {
      return handlePlaylistGenerator(env, url.origin);
    }

    // ================================================================
    // ২. প্রক্সি ইঞ্জিন (আসল লিংক হাইড করে ভিডিও চালানো)
    // লিংক: https://your-worker.dev/play/channelID
    // ================================================================
    if (url.pathname.startsWith('/play/')) {
      return handleProxyStream(request, env, url);
    }

    // ================================================================
    // ৩. অ্যাডমিন প্যানেল এবং API
    // ================================================================
    if (url.pathname === '/admin') return handleAdminPage();
    if (url.pathname === '/api/add' && request.method === 'POST') return handleAddChannel(request, env);
    if (url.pathname === '/api/delete' && request.method === 'POST') return handleDeleteChannel(request, env);
    if (url.pathname === '/api/list') return handleListChannels(env);

    // হোমপেজ
    return new Response(`M3U Playlist URL: ${url.origin}/playlist.m3u\nGo to /admin to manage channels.`, { status: 200 });
  }
};

// ================= ফাংশন: প্লেলিস্ট জেনারেটর =================

async function handlePlaylistGenerator(env, origin) {
  const list = await env.CHANNELS1.list();
  
  // M3U হেডলাইন
  let m3uContent = '#EXTM3U\n';

  for (const key of list.keys) {
    const dataStr = await env.CHANNELS1.get(key.name);
    if (dataStr) {
      const data = JSON.parse(dataStr);
      
      // আপনার চাওয়া ফরম্যাট:
      // #EXTINF:-1 tvg-id="name" tvg-name="name" tvg-logo="logo", Name
      // https://worker.dev/play/name
      
      m3uContent += `#EXTINF:-1 tvg-id="${data.title}" tvg-name="${data.title}" tvg-logo="${data.logo}",${data.title}\n`;
      m3uContent += `${origin}/play/${key.name}\n`;
    }
  }

  return new Response(m3uContent, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8', // এটি টেক্সট ফাইল হিসেবে দেখাবে
      'Access-Control-Allow-Origin': '*'
    }
  });
}

// ================= ফাংশন: প্রক্সি স্ট্রিম (ভিডিও চালানো) =================

async function handleProxyStream(request, env, url) {
  const parts = url.pathname.split('/'); 
  // parts[0]="", parts[1]="play", parts[2]="channelID", parts[3...]="path"
  
  const channelId = parts[2];
  const relativePath = parts.slice(3).join('/'); 

  // ১. ডাটাবেস থেকে তথ্য আনা
  const dataStr = await env.CHANNELS1.get(channelId);
  if (!dataStr) return new Response("Channel not found.", { status: 404 });

  const channelData = JSON.parse(dataStr);
  const originalFullUrl = channelData.url;

  // ২. টার্গেট URL তৈরি করা
  let targetUrl;
  try {
    if (!relativePath || relativePath === "") {
        targetUrl = originalFullUrl;
    } else {
        // রিলেটিভ পাথ হ্যান্ডেল করা
        if (relativePath.startsWith('http')) {
            targetUrl = relativePath;
        } else {
            const baseObj = new URL(originalFullUrl);
            const basePath = baseObj.href.substring(0, baseObj.href.lastIndexOf('/') + 1);
            targetUrl = new URL(relativePath, basePath).href;
        }
    }
  } catch (e) {
    return new Response("URL Error", { status: 500 });
  }

  // ৩. আসল সার্ভার থেকে ডাটা আনা (IP/Port ফিক্স সহ)
  try {
    const targetUrlObj = new URL(targetUrl);
    
    const response = await fetch(targetUrl, {
      method: request.method,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', // ব্রাউজার সাজা
        'Accept': '*/*',
        'Host': targetUrlObj.host // আইপি বা ডোমেইন হোস্ট হেডার সেট করা
      }
    });

    // M3U8 ফাইল হলে লিংক হাইড করা
    const contentType = response.headers.get('Content-Type');
    if (targetUrl.includes('.m3u8') || (contentType && (contentType.includes('mpegurl') || contentType.includes('application/x-mpegURL')))) {
      
      let m3u8Text = await response.text();
      
      // লিংক রিরাইট করা
      m3u8Text = rewriteM3u8Content(m3u8Text, url.origin, channelId);

      return new Response(m3u8Text, {
        headers: {
          'Content-Type': 'application/vnd.apple.mpegurl',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache'
        }
      });
    }

    // ভিডিও ফাইল (.ts) হলে সরাসরি পাঠানো
    const newResponse = new Response(response.body, response);
    newResponse.headers.set('Access-Control-Allow-Origin', '*');
    return newResponse;

  } catch (e) {
    return new Response("Stream Error: " + e.message, { status: 502 });
  }
}

// হেল্পার: M3U8 এর ভেতরের লিংক বদলানো
function rewriteM3u8Content(content, workerOrigin, channelId) {
  const lines = content.split('\n');
  const newLines = lines.map(line => {
    line = line.trim();
    if (!line) return line;
    if (!line.startsWith('#')) {
      return `${workerOrigin}/play/${channelId}/${line}`;
    }
    return line;
  });
  return newLines.join('\n');
}


// ================= অ্যাডমিন প্যানেল UI =================

async function handleAdminPage() {
  const html = `
  <!DOCTYPE html>
  <html>
  <head>
    <title>Stream Admin</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      body { font-family: sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; background: #eee; }
      .card { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
      input, button { width: 100%; padding: 12px; margin: 8px 0; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box; }
      button { background: #0070f3; color: white; border: none; font-weight: bold; cursor: pointer; }
      button:hover { background: #0051a2; }
      .item { border-bottom: 1px solid #eee; padding: 15px 0; display: flex; align-items: center; justify-content: space-between; }
      .item img { width: 50px; height: 50px; object-fit: contain; border: 1px solid #ddd; border-radius: 4px; margin-right: 15px; }
      .hidden { display: none; }
      .link-box { background: #e6f7ff; padding: 10px; margin-bottom: 20px; border: 1px solid #91d5ff; border-radius: 4px; word-break: break-all; text-align: center;}
    </style>
  </head>
  <body>
    <div class="card">
      <h2 style="text-align:center">IPTV Playlist Manager</h2>
      
      <div id="loginSection">
        <input type="password" id="pass" placeholder="Password">
        <button onclick="login()">Login</button>
      </div>

      <div id="mainSection" class="hidden">
        
        <div class="link-box">
          <strong>Playlist URL (Copy this):</strong><br>
          <a href="/playlist.m3u" target="_blank" id="plLink">.../playlist.m3u</a>
        </div>

        <h3>Add New Channel</h3>
        <input type="text" id="cTitle" placeholder="Channel Name (e.g. T Sports)">
        <input type="text" id="cLogo" placeholder="Logo URL (http://...)">
        <input type="text" id="cUrl" placeholder="Original Stream URL (Token link)">
        
        <button onclick="addChannel()">Add Channel</button>

        <h3>Channel List</h3>
        <div id="list">Loading...</div>
      </div>
    </div>

    <script>
      const API_PASS = "${ADMIN_PASSWORD}";
      
      function login() {
        if(document.getElementById('pass').value === API_PASS) {
          document.getElementById('loginSection').classList.add('hidden');
          document.getElementById('mainSection').classList.remove('hidden');
          const url = window.location.origin + '/playlist.m3u';
          document.getElementById('plLink').href = url;
          document.getElementById('plLink').innerText = url;
          loadChannels();
        } else { alert('Wrong Password'); }
      }

      async function addChannel() {
        const title = document.getElementById('cTitle').value.trim();
        const logo = document.getElementById('cLogo').value.trim();
        const url = document.getElementById('cUrl').value.trim();

        if(!title || !url) return alert('Name and URL are required!');

        // ইউনিক ID তৈরি
        const id = title.toLowerCase().replace(/[^a-z0-9]/g, '-');
        
        // এখানে Group বাদ দেওয়া হয়েছে
        const data = { name: id, title, logo, url };

        await fetch('/api/add', { method: 'POST', body: JSON.stringify(data) });
        
        document.getElementById('cTitle').value = '';
        document.getElementById('cUrl').value = '';
        loadChannels();
      }

      async function deleteChannel(id) {
        if(!confirm('Delete?')) return;
        await fetch('/api/delete', { method: 'POST', body: JSON.stringify({name: id}) });
        loadChannels();
      }

      async function loadChannels() {
        const res = await fetch('/api/list');
        const list = await res.json();
        const container = document.getElementById('list');
        container.innerHTML = '';

        for (const key in list) {
          const item = JSON.parse(list[key]);
          // প্রক্সি লিংক দেখানো (শুধুমাত্র দেখার জন্য)
          const proxyLink = window.location.origin + '/play/' + item.name;
          
          container.innerHTML += \`
            <div class="item">
              <div style="display:flex; align-items:center;">
                <img src="\${item.logo}" onerror="this.style.display='none'">
                <div>
                  <strong>\${item.title}</strong><br>
                  <small style="color:#666;">\${proxyLink}</small>
                </div>
              </div>
              <button onclick="deleteChannel('\${item.name}')" style="width:auto; background:#ff4d4f;">Delete</button>
            </div>
          \`;
        }
      }
    </script>
  </body>
  </html>
  `;
  return new Response(html, { headers: { 'Content-Type': 'text/html' } });
}

// ================= API হ্যান্ডলার =================
async function handleAddChannel(req, env) { 
    const data = await req.json(); 
    await env.CHANNELS1.put(data.name, JSON.stringify(data)); 
    return new Response("OK"); 
}
async function handleDeleteChannel(req, env) { 
    const data = await req.json(); 
    await env.CHANNELS1.delete(data.name); 
    return new Response("OK"); 
}
async function handleListChannels(env) { 
    const list = await env.CHANNELS1.list(); 
    const channels = {}; 
    for(const key of list.keys) { channels[key.name] = await env.CHANNELS1.get(key.name); } 
    return new Response(JSON.stringify(channels)); 
}
