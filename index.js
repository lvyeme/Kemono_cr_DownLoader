// ==UserScript==
// @name         Kemono → Motrix Ultimate (HTTPS RPC)
// @namespace    kemono-motrix-ultimate
// @version      1.2.0
// @description  kemono.cr → Motrix，支持平台识别 / 作者ID / 帖子ID / UI自定义保存路径
// @match        https://kemono.cr/*
// @icon         https://kemono.cr/static/favicon.ico
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      localhost
// ==/UserScript==

(() => {
    "use strict";

    /************** RPC 配置 **************/
    const RPC_ENDPOINT = "https://localhost:6801/jsonrpc";
    const ARIA2_TOKEN = "你的真实密钥";
    /************************************/

    /* ---------- 持久化配置 ---------- */
    const DEFAULT_BASE_DIR = "kemono";
    const BASE_DIR = GM_getValue("baseDir", DEFAULT_BASE_DIR);
    const AUTO_FAVORITE = GM_getValue("autoFavorite", false);

    /* ---------- aria2 ---------- */
    function addToAria2(filePath, url) {
        let dir = filePath.replace(/(.+?[\/\\])[^\/\\]+$/, "$1");
        let out = filePath.slice(dir.length);

        // 关键修复：aria2 RPC 只认 /
        dir = dir.replace(/\\/g, "/");
        out = out.replace(/\\/g, "/");

        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "POST",
                url: RPC_ENDPOINT,
                headers: {
                    "Content-Type": "application/json",
                    "Accept": "application/json"
                },
                data: JSON.stringify({
                    jsonrpc: "2.0",
                    id: crypto.randomUUID(),
                    method: "aria2.addUri",
                    params: [
                        `token:${ARIA2_TOKEN}`,
                        [url],
                        {dir, out}
                    ]
                }),
                onload: r => {
                    if (r.status === 200) {
                        resolve();
                    } else {
                        console.error("aria2 RPC 失败", r.status, r.responseText);
                        reject(r);
                    }
                },
                onerror: reject
            });
        });
    }

    /* ---------- utils ---------- */
    /**
     * 生成序号文件名：001.jpg / 002.zip
     * @param {number} index 从 0 开始
     * @param {string} originalName 原始文件名
     */
    function buildIndexedName(index, originalName) {
        const ext = originalName.match(/(\.[^.]+)$/)?.[1] || "";
        const num = String(index + 1).padStart(3, "0");
        return num + ext;
    }

    function tryFavoritePost() {
        const btn =
            document.querySelector("button._favoriteButton_377bd2a") ||
            document.querySelector(".post__actions button");

        if (!btn) {
            console.warn("未找到 Favorite 按钮");
            return;
        }

        // 已经收藏过就不点
        const icon = btn.querySelector("span");
        if (icon && icon.textContent.includes("★")) {
            return;
        }

        btn.click();
        console.log("已自动 Favorite");
    }

    /**
     * 转成网页自带文件名称
     * @param s
     * @returns {string}
     */
    const sanitize = s => s.replace(/[\\/:*?"<>|]/g, "_").trim();

    function getRealFileName(url) {
        const decoded = decodeURIComponent(url);

        // 优先使用 _f= 后的真实文件名
        const f = decoded.match(/[?&]_f=([^&]+)/);
        if (f) return f[1];

        // 兜底：取最后的路径名
        return decoded.split("/").pop().replace(/\?.*$/, "");
    }


    function getPlatform() {
        if (location.pathname.includes("/patreon/")) return "patreon";
        if (location.pathname.includes("/fanbox/")) return "fanbox";
        if (location.pathname.includes("/fantia/")) return "fantia";
        return "unknown";
    }

    function getIds() {
        const userId = location.pathname.match(/\/user\/(\d+)/)?.[1] || "unknown";
        const postId = location.pathname.match(/\/post\/(\d+)/)?.[1] || "unknown";
        return {userId, postId};
    }

    function getPostInfo() {
        const creator =
            document.querySelector("a.user-header__name")?.textContent ||
            document.querySelector(".post__user-name")?.textContent ||
            "unknown_creator";

        const title =
            document.querySelector(".post__title")?.textContent ||
            document.title ||
            "untitled_post";

        return {
            creator: sanitize(creator),
            title: sanitize(title)
        };
    }

    function getAllDownloadUrls() {
        const urls = new Set();

        /* ========== 1️⃣ 帖子图片区（img src="?f=xxx"） ========== */
        document.querySelectorAll(".post__files img").forEach(img => {
            const src = img.getAttribute("src");
            if (src && src.includes("/data/")) {
                urls.add(src.startsWith("http") ? src : location.origin + src);
            }
        });

        /* ========== 2️⃣ 可下载附件（zip / rar / 7z 等） ========== */
        document.querySelectorAll("a.post__attachment-link").forEach(a => {
            const href = a.getAttribute("href");
            if (href && href.includes("/data/")) {
                urls.add(href.startsWith("http") ? href : location.origin + href);
            }
        });

        /* ========== 3️⃣ fileThumb（老结构 / 缩略图 a[href]） ========== */
        document.querySelectorAll("a.fileThumb[href]").forEach(a => {
            const href = a.getAttribute("href");
            if (href && href.includes("/data/")) {
                urls.add(href.startsWith("http") ? href : location.origin + href);
            }
        });

        /* ========== 4️⃣ 视频 / 音频（video / audio src） ========== */
        document.querySelectorAll("video source, audio source").forEach(srcEl => {
            const src = srcEl.getAttribute("src");
            if (src && src.includes("/data/")) {
                urls.add(src.startsWith("http") ? src : location.origin + src);
            }
        });

        return [...urls];
    }


    /* ---------- UI ---------- */
    function addUI() {
        const box = document.createElement("div");
        box.style.cssText = `
            position: fixed;
            right: 20px;
            bottom: 40px;
            z-index: 9999;
            background: #222;
            color: #fff;
            padding: 10px;
            border-radius: 8px;
            font-size: 13px;
        `;
        // 自动 Favorite 开关
        const favToggle = document.createElement("label");
        favToggle.style.cssText = "display:block;margin-top:6px;cursor:pointer";

        const favCheckbox = document.createElement("input");
        favCheckbox.type = "checkbox";
        favCheckbox.checked = AUTO_FAVORITE;

        favCheckbox.onchange = () => {
            GM_setValue("autoFavorite", favCheckbox.checked);
        };

        favToggle.appendChild(favCheckbox);
        favToggle.append(" 下载完成后自动 Favorite");

        /**
         * 选择要下载的文件（UI 显示原始文件名）
         * @param urls
         * @returns {Promise<string[]>}
         */
        function showFilePicker(urls) {
            return new Promise(resolve => {
                const overlay = document.createElement("div");
                overlay.style.cssText = `
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,.6);
            z-index: 10000;
            display: flex;
            align-items: center;
            justify-content: center;
        `;

                const box = document.createElement("div");
                box.style.cssText = `
            background: #222;
            color: #fff;
            padding: 16px;
            width: 460px;
            max-height: 70vh;
            overflow: auto;
            border-radius: 8px;
            font-size: 13px;
        `;
                box.innerHTML = `<b>选择要下载的文件（显示原名）</b><hr style="opacity:.3">`;

                const list = document.createElement("div");

                urls.forEach((url, i) => {
                    // 👉 UI 显示用：真实文件名
                    const realName = getRealFileName(url);

                    const row = document.createElement("label");
                    row.style.cssText = `
                display: block;
                margin: 4px 0;
                cursor: pointer;
                word-break: break-all;
            `;

                    row.innerHTML = `
                <input type="checkbox" data-i="${i}" checked>
                <span style="opacity:.85">${realName}</span>
            `;
                    list.appendChild(row);
                });

                const ok = document.createElement("button");
                ok.textContent = "开始下载";

                const backBtn = document.createElement("button");
                backBtn.textContent = "返回";
                backBtn.style.marginRight = "8px";

                const btnBar = document.createElement("div");
                btnBar.style.cssText = "margin-top:10px;text-align:right";
                btnBar.appendChild(backBtn);
                btnBar.appendChild(ok);

                backBtn.onclick = () => {
                    document.body.removeChild(overlay);
                };

                ok.onclick = () => {
                    const checked = [...list.querySelectorAll("input:checked")]
                        .map(i => urls[i.dataset.i]);
                    document.body.removeChild(overlay);
                    resolve(checked);
                };

                box.appendChild(list);
                box.appendChild(btnBar);
                overlay.appendChild(box);
                document.body.appendChild(overlay);
            });
        }

        /**
         * 自定义下载路径
         * @type {HTMLButtonElement}
         */
        const btn = document.createElement("button");
        btn.textContent = "⬇ 发送到 Motrix";
        btn.style.marginRight = "6px";

        const cfg = document.createElement("button");
        cfg.textContent = "⚙ 路径";

        btn.onclick = async () => {
            const platform = getPlatform();
            const {userId, postId} = getIds();
            const {creator, title} = getPostInfo();
            /**
             * 下载按钮
             */
            let urls = getAllDownloadUrls();

            if (!urls.length) {
                alert("已收藏未找到可下载文件");
                return;
            }

            // ⬇⬇⬇ 新增：弹出勾选窗口
            urls = await showFilePicker(urls);
            if (!urls.length) {
                alert("未选择任何文件");
                return;
            }

            let ok = 0, fail = 0;

            for (let i = 0; i < urls.length; i++) {
                const url = urls[i];

                const realName = getRealFileName(url);
                const indexedName = buildIndexedName(i, realName);

                const sep = BASE_DIR.match(/^[A-Za-z]:\\/) ? "\\" : "/";

                const path =
                    BASE_DIR +
                    sep + `(${platform}) ${creator}_${userId}` +
                    sep + `${title}_${postId}` +
                    sep + indexedName;

                try {
                    await addToAria2(path, url);
                    ok++;
                } catch {
                    fail++;
                }
            }


            if (GM_getValue("autoFavorite", false) && ok > 0 && fail === 0) {

                tryFavoritePost();
            }

        };

        cfg.onclick = () => {
            const v = prompt(
                "设置保存根目录（支持绝对路径，如 D:\\d）",
                BASE_DIR
            );
            if (v) {
                GM_setValue("baseDir", v.trim());
                alert("已保存，刷新后生效");
            }
        };


        box.appendChild(btn);
        box.appendChild(cfg);
        box.appendChild(favToggle);
        document.body.appendChild(box);
    }

    addUI();
})();
