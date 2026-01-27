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
    const ARIA2_TOKEN  = "***";
    /************************************/

    /* ---------- 持久化配置 ---------- */
    const DEFAULT_BASE_DIR = "kemono";
    const BASE_DIR = GM_getValue("baseDir", DEFAULT_BASE_DIR);
    const AUTO_FAVORITE = GM_getValue("autoFavorite", false);
    const NAME_MODE = GM_getValue("nameMode", "original");
    const USE_YEAR_FOLDER = GM_getValue("useYearFolder", false);
    const USE_ORIGINAL_NAME = GM_getValue("useOriginalName", false);
    const USE_PLATFORM = GM_getValue("usePlatform", false);
    const USE_AUTHOR_ID = GM_getValue("useAuthorId", false);
    const USE_POST_ID = GM_getValue("usePostId", false);
    const USE_POST_FOLDER = GM_getValue("usePostFolder", false);

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
                        { dir, out }
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

        // ✅ kemono 正确参数：?f=真实文件名
        const f = decoded.match(/[?&]f=([^&]+)/);
        if (f) return f[1];

        // 兜底：hash 名
        return decoded.split("/").pop().replace(/\?.*$/, "");
    }

    function getPlatform() {
        if (location.pathname.includes("/patreon/")) return "patreon";
        if (location.pathname.includes("/fanbox/"))  return "fanbox";
        if (location.pathname.includes("/fantia/")) return "fantia";
        return "unknown";
    }

    function getIds() {
        const userId = location.pathname.match(/\/user\/(\d+)/)?.[1] || "unknown";
        const postId = location.pathname.match(/\/post\/(\d+)/)?.[1] || "unknown";
        return { userId, postId };
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

    /**
     * 获取帖子年份函数
     * @returns {string}
     */
    function getPostYear() {
        const timeEl = document.querySelector(".post__published time.timestamp");
        if (!timeEl) return "unknown_year";

        const dt = timeEl.getAttribute("datetime"); // 2021-01-28T14:51:08
        if (!dt) return "unknown_year";

        return dt.slice(0, 4); // 取年份
    }


    function getAllDownloadUrls() {
        const urls = new Set();

        /* ========== 1️⃣ 图片 / 漫画（必须从 a.fileThumb[href] 取） ========== */
        document.querySelectorAll("a.fileThumb[href]").forEach(a => {
            const href = a.getAttribute("href");
            if (href && href.includes("/data/")) {
                urls.add(href.startsWith("http") ? href : location.origin + href);
            }
        });

        /* ========== 2️⃣ 附件（zip / rar / psd / etc） ========== */
        document.querySelectorAll("a.post__attachment-link[href]").forEach(a => {
            const href = a.getAttribute("href");
            if (href && href.includes("/data/")) {
                urls.add(href.startsWith("http") ? href : location.origin + href);
            }
        });

        /* ========== 3️⃣ video / audio ========== */
        document.querySelectorAll("video source, audio source").forEach(el => {
            const src = el.getAttribute("src");
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

        /* ---------- 命名方式选择 ---------- */
        const nameModeWrap = document.createElement("div");
        nameModeWrap.style.cssText = "margin-top:6px";

        const nameSelect = document.createElement("select");
        nameSelect.innerHTML = `
        <option value="original">使用原文件名称</option>
        <option value="index">自动按序号重命名（001.jpg）</option>
    `;
        nameSelect.value = NAME_MODE;
        nameSelect.onchange = () => {
            GM_setValue("nameMode", nameSelect.value);
        };

        nameModeWrap.append("文件命名：");
        nameModeWrap.appendChild(nameSelect);

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
                box.innerHTML = `
                <b>选择要下载的文件（显示原名）</b>
                <label style="float:right;cursor:pointer;font-size:12px;">
                  <input type="checkbox" id="selectAll" checked> 全选
                </label>
                <hr style="opacity:.3;clear:both">
                `;

                const list = document.createElement("div");

                const mode = GM_getValue("nameMode", "original");

                urls.forEach((url, i) => {
                    const realName = getRealFileName(url);
                    const indexedName = buildIndexedName(i, realName);

                    const display =
                        mode === "index"
                            ? `<b>${indexedName}</b> <span style="opacity:.6">← ${realName}</span>`
                            : realName;

                    const row = document.createElement("label");
                    row.style.cssText = `
                    display: block;
                    margin: 4px 0;
                    cursor: pointer;
                    word-break: break-all;
                `;

                    row.innerHTML = `
                    <input type="checkbox" data-i="${i}" checked>
                    <span>${display}</span>
                `;

                    list.appendChild(row);
                });

                const selectAll = box.querySelector("#selectAll");

                // 全选 → 控制所有文件勾选
                selectAll.onchange = () => {
                    const checks = list.querySelectorAll("input[type=checkbox]");
                    checks.forEach(cb => cb.checked = selectAll.checked);
                };

                // 单个取消 → 自动取消全选
                list.addEventListener("change", () => {
                    const checks = list.querySelectorAll("input[type=checkbox]");
                    const allChecked = [...checks].every(cb => cb.checked);
                    selectAll.checked = allChecked;
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
         * 路径预览
         */
        function updatePathPreview() {
            const useYear = GM_getValue("useYearFolder", false);
            const usePlatform = GM_getValue("usePlatform", false);
            const useAuthorId = GM_getValue("useAuthorId", false);
            const usePostFolder = GM_getValue("usePostFolder", false);
            const usePostId = GM_getValue("usePostId", false);
            const mode = GM_getValue("nameMode", "original");

            const { userId, postId } = getIds();
            const { creator, title } = getPostInfo();
            const platform = getPlatform();
            const year = getPostYear();

            const sampleFile = mode === "original" ? "example.jpg" : "001.jpg";

            let authorFolder = creator;
            if (useAuthorId) authorFolder += "_" + userId;
            if (usePlatform) authorFolder = `(${platform}) ` + authorFolder;

            const postFolderName = usePostId
                ? `${title}_${postId}`
                : `${title}`;

            let path =
                BASE_DIR +
                "/" + authorFolder +
                (useYear ? "/" + year : "");

            if (usePostFolder) {
                path += "/" + postFolderName;
            }

            path += "/" + sampleFile;

            document.getElementById("pathPreview").textContent =
                "路径预览：" + path;
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
            const { userId, postId } = getIds();
            const { creator, title } = getPostInfo();
            const year = getPostYear();

            const useYear = GM_getValue("useYearFolder", false);
            const usePlatform = GM_getValue("usePlatform", false);
            const useAuthorId = GM_getValue("useAuthorId", false);
            const usePostFolder = GM_getValue("usePostFolder", false);
            const mode = GM_getValue("nameMode", "original");

            /**
             * 下载按钮
             */
            let urls = getAllDownloadUrls();

            if (!urls.length) {
                alert("未找到可下载文件");
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
                const mode = GM_getValue("nameMode", "original");

                const realName = getRealFileName(url);
                const fileName =
                    mode === "index"
                        ? buildIndexedName(i, realName)
                        : realName;

                const sep = BASE_DIR.match(/^[A-Za-z]:\\/) ? "\\" : "/";

                let authorFolder = creator;
                if (useAuthorId) authorFolder += "_" + userId;
                if (usePlatform) authorFolder = `(${platform}) ` + authorFolder;

                // 帖子文件夹名
                const postFolderName = GM_getValue("usePostId", false)
                    ? `${title}_${postId}`
                    : `${title}`;

                let path =
                    BASE_DIR +
                    sep + authorFolder +
                    (useYear ? sep + year : "");

                // 是否按帖子建文件夹
                if (usePostFolder) {
                    path += sep + postFolderName;
                }
                // 最终文件路径
                path += sep + fileName;


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

        // ===== 统一设置栏 =====
        const settingsBox = document.createElement("div");
        settingsBox.style.cssText = "margin-top:8px;border-top:1px solid #555;padding-top:6px;font-size:12px";

        settingsBox.innerHTML = `
        <label><input type="checkbox" id="optYear"> 按年份存放</label><br>
        <label><input type="checkbox" id="optName"> 使用原文件名</label><br>
        <label><input type="checkbox" id="optPlatform"> 包含平台(fanbox/patreon)</label><br>
        <label><input type="checkbox" id="optAuthor"> 包含作者ID</label><br>
        <label><input type="checkbox" id="optPostId"> 包含帖子ID</label><br>
        <label><input type="checkbox" id="optPost"> 按帖子建文件夹</label>
        `;


        const optYear = settingsBox.querySelector("#optYear");
        const optName = settingsBox.querySelector("#optName");
        const optPlatform = settingsBox.querySelector("#optPlatform");
        const optAuthor = settingsBox.querySelector("#optAuthor");
        const optPostId = settingsBox.querySelector("#optPostId");
        const optPost = settingsBox.querySelector("#optPost");

        optYear.checked = USE_YEAR_FOLDER;
        optName.checked = USE_ORIGINAL_NAME;
        optPlatform.checked = USE_PLATFORM;
        optAuthor.checked = USE_AUTHOR_ID;
        optPostId.checked = USE_POST_ID;
        optPost.checked = USE_POST_FOLDER;

        optYear.onchange = () => {
            GM_setValue("useYearFolder", optYear.checked);
            updatePathPreview();
        };
        optName.onchange = () => {
            GM_setValue("useOriginalName", optName.checked);
            updatePathPreview();
        };
        optPlatform.onchange = () => {
            GM_setValue("usePlatform", optPlatform.checked);
            updatePathPreview();
        };
        optAuthor.onchange = () => {
            GM_setValue("useAuthorId", optAuthor.checked);
            updatePathPreview();
        };
        optPost.onchange = () => {
            GM_setValue("usePostFolder", optPost.checked);
            updatePathPreview();
        };
        optPostId.onchange = () => {
            GM_setValue("usePostId", optPostId.checked);
            updatePathPreview();
        };

        box.appendChild(btn);
        box.appendChild(cfg);
        box.appendChild(settingsBox);
        // ===== 路径预览 =====
        const pathPreview = document.createElement("div");
        pathPreview.style.cssText = `
        margin-top:6px;
        padding:6px;
        background:#111;
        border:1px solid #555;
        border-radius:4px;
        font-size:12px;
        color:#0f0;
        word-break: break-all;
        `;
        pathPreview.id = "pathPreview";
        pathPreview.textContent = "路径预览：";

        box.appendChild(pathPreview);
        box.appendChild(favToggle);
        box.appendChild(nameModeWrap);
        document.body.appendChild(box);
        updatePathPreview();
    }

    addUI();
})();