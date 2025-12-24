// অ্যাডমিন প্যানেলে ঢোকার পাসওয়ার্ড
const ADMIN_PASSWORD = "12345"; 

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // ================================================================
    // ১. অ্যাডমিন প্যানেল এবং API (আগের মতোই)
    // ================================================================
    
    if (url.pathname === '/admin') {
      return handleAdminPage(request);
    }
    if (url.pathname === '/api/add' && request.method === 'POST') {
      return handleAddChannel(request, env);
    }
    if (url.pathname === '/api/delete' && request.method === 'POST') {
      return handleDeleteChannel(request, env);
    }
    if (url.pathname === '/api/list') {
      return handleListChannels(env);
    }

    // ================================================================
    // ২. ভিডিও স্ট্রিমিং লজিক (সম্পূর্ণ নতুন এবং শক্তিশালী)
    // ================================================================
    
    if (url.pathname.startsWith('/play/')) {
      const parts = url.pathname.split('/');
      const channelName = parts[2];
      
      // বাকী অংশটুকু (যেমন: tracks-v1a1/mono.ts.m3u8)
      const relativePath = parts.slice(3).join('/'); 

      // ১. আসল মেইন লিংকটি ডাটাবেস থেকে আনা
      const rootUrlStr = await env.CHANNELS1.get(channelName);

      if (!rootUrlStr) {
        return new Response("Channel not found in Database.", { status: 404 });
      }

      // ২. টার্গেট URL তৈরি করা (যেটা আমরা এখন ফেচ করব)
      let targetUrl;
      let rootBase; // এটি মেইন ফোল্ডারের ঠিকানা

      try {
        const rootObj = new URL(rootUrlStr);
        // মেইন লিংকের বেস পাথ বের করা (যেমন: http://site.com/folder/)
        rootBase = rootObj.href.substring(0, rootObj.href.lastIndexOf('/') + 1);

        if (!relativePath) {
            // যদি সরাসরি চ্যানেল প্লে করা হয়
            targetUrl = rootUrlStr;
        } else {
            // যদি ভেতরের কোনো ফাইল চাওয়া হয়, তাহলে মেইন বেস-এর সাথে জোড়া লাগানো
            targetUrl = new URL(relativePath, rootBase).href;
        }
      } catch (e) {
        return new Response("Invalid URL Configuration", { status: 500 });
      }

      // ৩. অরিজিনাল সার্ভার থেকে ডাটা আনা
      try {
        const response = await fetch(targetUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': new URL(targetUrl).origin
          }
        });

        if (!response.ok) {
            return new Response(`Source Error: ${response.status}`, { status: response.status });
        }

        // ৪. যদি M3U8 ফাইল হয়, তবে রিরাইট (Rewrite) করতে হবে
        if (targetUrl.includes('.m3u8') || response.headers.get('Content-Type')?.includes('mpegurl') || response.headers.get('Content-Type')?.includes('application/x-mpegURL')) {
          
          let m3u8Text = await response.text();
          
          // এখানে ম্যাজিক ফাংশন কল করা হচ্ছে
          m3u8Text = rewriteM3u8(m3u8Text, url.origin, channelName, targetUrl, rootBase);

          return new Response(m3u8Text, {
            headers: {
              'Content-Type': 'application/vnd.apple.mpegurl',
              'Access-Control-Allow-Origin': '*',
              'Cache-Control': 'no-cache'
            }
          });
        }

        // ৫. যদি .ts বা অন্য ফাইল হয়, সরাসরি দিয়ে দেওয়া হবে
        const newRes = new Response(response.body, response);
        newRes.headers.set('Access-Control-Allow-Origin', '*');
        return newRes;

      } catch (e) {
        return new Response(`Worker Error: ${e.message}`, { status: 500 });
      }
    }

    return new Response("Proxy Running. Go to /admin", { status: 200 });
  }
};

// ================= HELPER FUNCTIONS (নতুন লজিক) =================

function rewriteM3u8(content, workerOrigin, channelName, currentFileUrl, rootBaseUrl) {
  const lines = content.split('\n');
  const newLines = lines.map(line => {
    // স্পেস বা অপ্রয়োজনীয় ক্যারেক্টার রিমুভ (খুবই জরুরি)
    line = line.trim();
    if (!line) return line;
    
    // কমেন্ট লাইন বা ট্যাগ ইগনোর করা
    if (line.startsWith('#')) {
      return line;
    }

    // লজিক: লাইনের লিংকটি যেখানেই থাক, সেটার "আসল পূর্ণ ঠিকানা" (Absolute URL) বের করা
    try {
        const absoluteUrl = new URL(line, currentFileUrl).href;

        // চেক করা: এই লিংকটি কি আমাদের মেইন সার্ভারের ভেতরেই আছে?
        if (absoluteUrl.startsWith(rootBaseUrl)) {
            // যদি ভেতরে থাকে, তাহলে "rootBaseUrl" বাদ দিয়ে বাকীটুকু (Relative Path) বের করা
            const newRelativePath = absoluteUrl.replace(rootBaseUrl, '');
            
            // আমাদের প্রোক্সি লিংক তৈরি
            return `${workerOrigin}/play/${channelName}/${newRelativePath}`;
        } else {
            // যদি অন্য কোনো সার্ভারে রিডাইরেক্ট করে (যেমন অন্য CDN), তাহলে সরাসরি সেই লিংক বসিয়ে দেওয়া
            // এতে প্লেয়ার সরাসরি সেখান থেকে চালাবে (এতে ভিডিও লোড দ্রুত হয়)
            return absoluteUrl;
        }
    } catch (e) {
        return line; // কোনো সমস্যা হলে যা আছে তাই থাকবে
    }
  });
  return newLines.join('\n');
}

// ================= ADMIN & API (অপরিবর্তিত) =================

async function handleAdminPage(request) {
    // আগের অ্যাডমিন কোডই থাকবে, এখানে চেঞ্জ নেই
    const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>Stream Admin</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
            body { font-family: sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; background: #f4f4f4; }
            .container { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.1); }
            input, button { padding: 10px; margin: 5px 0; width: 100%; box-sizing: border-box; border: 1px solid #ddd; border-radius: 4px;}
            button { background: #0070f3; color: white; border: none; cursor: pointer; }
            button:hover { background: #0051a2; }
            .item { border-bottom: 1px solid #eee; padding: 10px 0; }
            code { background: #eee; padding: 2px 5px; display: block; margin-top: 5px; word-break: break-all; }
            .hidden { display: none; }
            h3 { margin-top: 0; }
        </style>
    </head>
    <body>
        <div class="container">
            <h2 style="text-align:center;">Stream Controller</h2>
            <div id="loginSection">
                <input type="password" id="pass" placeholder="Enter Password">
                <button onclick="checkPass()">Login</button>
            </div>
            <div id="mainSection" class="hidden">
                <h3>Add Channel</h3>
                <input type="text" id="cName" placeholder="Name (e.g. sports)">
                <input type="text" id="cUrl" placeholder="Original M3U8 Link">
                <button onclick="addChannel()">Add Channel</button>
                <h3 style="margin-top:20px;">Channel List</h3>
                <div id="list">Loading...</div>
            </div>
        </div>
        <script>
            const API_PASS = "${ADMIN_PASSWORD}"; 
            function checkPass() {
                if(document.getElementById('pass').value === API_PASS) {
                    document.getElementById('loginSection').classList.add('hidden');
                    document.getElementById('mainSection').classList.remove('hidden');
                    loadChannels();
                } else { alert('Wrong Password'); }
            }
            async function addChannel() {
                const name = document.getElementById('cName').value.trim();
                const url = document.getElementById('cUrl').value.trim();
                if(!name || !url) return alert('Fill all fields');
                await fetch('/api/add', { method: 'POST', body: JSON.stringify({name, url}) });
                document.getElementById('cName').value = '';
                document.getElementById('cUrl').value = '';
                loadChannels();
            }
            async function deleteChannel(name) {
                if(!confirm('Delete ' + name + '?')) return;
                await fetch('/api/delete', { method: 'POST', body: JSON.stringify({name}) });
                loadChannels();
            }
            async function loadChannels() {
                const res = await fetch('/api/list');
                const channels = await res.json();
                const list = document.getElementById('list');
                list.innerHTML = '';
                for (const [name, url] of Object.entries(channels)) {
                    const proxyLink = window.location.origin + '/play/' + name;
                    list.innerHTML += \`
                        <div class="item">
                            <div style="font-weight:bold; color: #333;">\${name}</div>
                            <small style="color: #666;">Orig: \${url.substring(0, 30)}...</small>
                            <code>\${proxyLink}</code>
                            <button onclick="deleteChannel('\${name}')" style="background:#ff4d4f; margin-top:5px;">Delete</button>
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

async function handleAddChannel(req, env) {
    const data = await req.json();
    await env.CHANNELS1.put(data.name, data.data || data.url);
    return new Response("Added");
}
async function handleDeleteChannel(req, env) {
    const data = await req.json();
    await env.CHANNELS1.delete(data.name);
    return new Response("Deleted");
}
async function handleListChannels(env) {
    const list = await env.CHANNELS1.list();
    const channels = {};
    for(const key of list.keys) {
        channels[key.name] = await env.CHANNELS1.get(key.name);
    }
    return new Response(JSON.stringify(channels));
}
