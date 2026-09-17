// FHL Bible API Service Module
// Centralized service for Bible scripture parsing and FHL API querying.
// Shared by LKC_ppt_generator, LKC_MinistrySchedule, and LKC_SundayBulletin.

(function (window) {
    'use strict';

    // 1. 聖經 66 卷書完整對照表
    const BIBLE_BOOKS = [
        // 舊約 (39卷)
        { full: "創世記", short: "創", eng: "Gen", chapters: 50 },
        { full: "出埃及記", short: "出", eng: "Ex", chapters: 40 },
        { full: "利未記", short: "利", eng: "Lev", chapters: 27 },
        { full: "民數記", short: "民", eng: "Num", chapters: 36 },
        { full: "申命記", short: "申", eng: "Deut", chapters: 34 },
        { full: "約書亞記", short: "書", eng: "Josh", chapters: 24 },
        { full: "士師記", short: "士", eng: "Judg", chapters: 21 },
        { full: "路得記", short: "得", eng: "Ruth", chapters: 4 },
        { full: "撒母耳記上", short: "撒上", eng: "1Sam", chapters: 31 },
        { full: "撒母耳記下", short: "撒下", eng: "2Sam", chapters: 24 },
        { full: "列王紀上", short: "王上", eng: "1Kings", chapters: 22 },
        { full: "列王紀下", short: "王下", eng: "2Kings", chapters: 25 },
        { full: "歷代志上", short: "代上", eng: "1Chron", chapters: 29 },
        { full: "歷代志下", short: "代下", eng: "2Chron", chapters: 36 },
        { full: "以斯拉記", short: "拉", eng: "Ezra", chapters: 10 },
        { full: "尼希米記", short: "尼", eng: "Neh", chapters: 13 },
        { full: "以斯帖記", short: "斯", eng: "Esth", chapters: 10 },
        { full: "約伯記", short: "伯", eng: "Job", chapters: 42 },
        { full: "詩篇", short: "詩", eng: "Ps", chapters: 150 },
        { full: "箴言", short: "箴", eng: "Prov", chapters: 31 },
        { full: "傳道書", short: "傳", eng: "Eccles", chapters: 12 },
        { full: "雅歌", short: "歌", eng: "Song", chapters: 8 },
        { full: "以賽亞書", short: "賽", eng: "Isa", chapters: 66 },
        { full: "耶利米書", short: "耶", eng: "Jer", chapters: 52 },
        { full: "耶利米哀歌", short: "哀", eng: "Lam", chapters: 5 },
        { full: "以西結書", short: "結", eng: "Ezek", chapters: 48 },
        { full: "但以理書", short: "但", eng: "Dan", chapters: 12 },
        { full: "何西阿書", short: "何", eng: "Hos", chapters: 14 },
        { full: "約珥書", short: "珥", eng: "Joel", chapters: 3 },
        { full: "阿摩司書", short: "摩", eng: "Amos", chapters: 9 },
        { full: "俄巴底亞書", short: "俄", eng: "Obad", chapters: 1 },
        { full: "約拿書", short: "拿", eng: "Jonah", chapters: 4 },
        { full: "彌迦書", short: "彌", eng: "Mic", chapters: 7 },
        { full: "那鴻書", short: "鴻", eng: "Nah", chapters: 3 },
        { full: "哈巴谷書", short: "哈", eng: "Hab", chapters: 3 },
        { full: "西番雅書", short: "番", eng: "Zeph", chapters: 3 },
        { full: "哈該書", short: "該", eng: "Hag", chapters: 2 },
        { full: "撒迦利亞書", short: "亞", eng: "Zech", chapters: 14 },
        { full: "瑪拉基書", short: "瑪", eng: "Mal", chapters: 4 },

        // 新約 (27卷)
        { full: "馬太福音", short: "太", eng: "Matt", chapters: 28 },
        { full: "馬可福音", short: "可", eng: "Mark", chapters: 16 },
        { full: "路加福音", short: "路", eng: "Luke", chapters: 24 },
        { full: "約翰福音", short: "約", eng: "John", chapters: 21 },
        { full: "使徒行傳", short: "徒", eng: "Acts", chapters: 28 },
        { full: "羅馬書", short: "羅", eng: "Rom", chapters: 16 },
        { full: "哥林多前書", short: "林前", eng: "1Cor", chapters: 16 },
        { full: "哥林多後書", short: "林後", eng: "2Cor", chapters: 13 },
        { full: "加拉太書", short: "加", eng: "Gal", chapters: 6 },
        { full: "以弗所書", short: "弗", eng: "Eph", chapters: 6 },
        { full: "腓立比書", short: "腓", eng: "Phil", chapters: 4 },
        { full: "歌羅西書", short: "西", eng: "Col", chapters: 4 },
        { full: "帖撒羅尼迦前書", short: "帖前", eng: "1Thess", chapters: 5 },
        { full: "帖撒羅尼迦後書", short: "帖後", eng: "2Thess", chapters: 3 },
        { full: "提摩太前書", short: "提前", eng: "1Tim", chapters: 6 },
        { full: "提摩太後書", short: "提後", eng: "2Tim", chapters: 4 },
        { full: "提多書", short: "多", eng: "Titus", chapters: 3 },
        { full: "腓利門書", short: "門", eng: "Philem", chapters: 1 },
        { full: "希伯來書", short: "希", eng: "Heb", chapters: 13 },
        { full: "雅格書", short: "雅", eng: "Jas", chapters: 5 }, // Also support 雅各書, but key matching handles both
        { full: "彼得前書", short: "彼前", eng: "1Pet", chapters: 5 },
        { full: "彼得後書", short: "彼後", eng: "2Pet", chapters: 3 },
        { full: "約翰一書", short: "約一", eng: "1John", chapters: 5 },
        { full: "約翰二書", short: "約二", eng: "2John", chapters: 1 },
        { full: "約翰三書", short: "約三", eng: "3John", chapters: 1 },
        { full: "猶大書", short: "猶", eng: "Jude", chapters: 1 },
        { full: "啟示錄", short: "啟", eng: "Rev", chapters: 22 }
    ];

    // Ensure "雅各書" works (matching either 雅格書 or 雅各書)
    BIBLE_BOOKS.forEach(b => {
        if (b.full === "雅格書") {
            b.altFull = "雅各書";
        }
    });

    // 2. 輔助函數：中文數字轉阿拉伯數字
    function chineseToArabic(str) {
        const charMap = {
            '零': 0, '〇': 0,
            '一': 1, '二': 2, '兩': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9,
            '十': 10, '廿': 20, '卅': 30, '卌': 40, '百': 100
        };
        if (/^\d+$/.test(str)) {
            return parseInt(str, 10);
        }
        let val = 0;
        let temp = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str[i];
            const num = charMap[char];
            if (num === undefined) continue;
            
            if (num === 10) {
                if (temp === 0) temp = 1;
                val += temp * 10;
                temp = 0;
            } else if (num === 20 || num === 30 || num === 40) {
                val += num;
                temp = 0;
            } else if (num === 100) {
                if (temp === 0) temp = 1;
                val += temp * 100;
                temp = 0;
            } else {
                temp = num;
            }
        }
        val += temp;
        return val;
    }

    // 3. 輔助函數：生成 Regex 匹配對象
    function idToRegex(id) {
        let escaped = id.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        escaped = escaped.replace(/\s+/g, '\\s*');
        const chars = id.replace(/\s+/g, '').split('');
        const pattern = chars.map(c => c + '\\s*').join('');
        if (/^[a-zA-Z0-9\s]+$/.test(id)) {
            return new RegExp('^' + pattern, 'i');
        } else {
            return new RegExp('^' + pattern);
        }
    }

    // 4. 輔助函數：解析章節節數
    function parseChapterAndVerse(str) {
        let normalized = str.trim()
            .replace(/：/g, ':')
            .replace(/[~～－—至]/g, '-')
            .replace(/\s+/g, ' ');
        
        // 4.1 全章格式帶冒號 (e.g. 37:全, 37:1-末, 37:1-最後, 37:1-end)
        const regexChapColonAll = /^([零〇一二兩三四五六七八九十廿卅卌百]+|\d+)\s*[:\s]\s*(全|全章|全篇|1-末|1-最後|1-end)$/i;
        let matchAll = normalized.match(regexChapColonAll);
        if (matchAll) {
            const chap = chineseToArabic(matchAll[1]);
            if (isNaN(chap) || chap <= 0) return null;
            return { chap: chap, sec: "" };
        }

        // 4.2 章與節 (e.g. 37:25-26, 一1-11)
        const regex1 = /^([零〇一二兩三四五六七八九十廿卅卌百]+|\d+)\s*[:\s]\s*([\d\-,\s]+)$/;
        const regex2 = /^([零〇一二兩三四五六七八九十廿卅卌百]+)\s*([\d\-,\s]+)$/;
        
        let match = normalized.match(regex1) || normalized.match(regex2);
        if (match) {
            const chap = chineseToArabic(match[1]);
            if (isNaN(chap) || chap <= 0) return null;
            return {
                chap: chap,
                sec: match[2].replace(/\s+/g, '')
            };
        }
        
        // 4.3 僅章數 (e.g. 37, 第37, 37章, 37篇, 37全, 37章全, 37全章)
        const regexChapOnly = /^第?\s*([零〇一二兩三四五六七八九十廿卅卌百]+|\d+)\s*([章篇]|章全|全|全章|全篇)?$/;
        let matchChap = normalized.match(regexChapOnly);
        if (matchChap) {
            const chap = chineseToArabic(matchChap[1]);
            if (isNaN(chap) || chap <= 0) return null;
            return { chap: chap, sec: "" };
        }
        
        return null;
    }

    // 5. 輔助函數：解析單個段落輸入
    function parseScriptureInput(inputStr) {
        const trimmed = inputStr.trim();
        if (!trimmed) return null;
        
        const candidates = [];
        for (const book of BIBLE_BOOKS) {
            candidates.push({ book, id: book.full });
            candidates.push({ book, id: book.short });
            candidates.push({ book, id: book.eng });
            if (book.altFull) {
                candidates.push({ book, id: book.altFull });
            }
        }
        candidates.sort((a, b) => b.id.length - a.id.length);
        
        for (const cand of candidates) {
            const regex = idToRegex(cand.id);
            const match = trimmed.match(regex);
            if (match) {
                const matchedLength = match[0].length;
                const rest = trimmed.slice(matchedLength).trim();
                
                // 支援單章書卷無章數輸入防呆 (e.g. 猶大書 -> 猶大書 1章, 猶大書 全 -> 猶大書 1章)
                if ((rest === "" || /^(全|全書|整卷|全卷)$/.test(rest)) && cand.book.chapters === 1) {
                    return {
                        eng: cand.book.eng,
                        short: cand.book.short,
                        chap: 1,
                        sec: "",
                        bookName: cand.book.full
                    };
                }
                
                const parsedCV = parseChapterAndVerse(rest);
                if (parsedCV) {
                    return {
                        eng: cand.book.eng,
                        short: cand.book.short,
                        chap: parsedCV.chap,
                        sec: parsedCV.sec,
                        bookName: cand.book.full
                    };
                }
            }
        }
        return null;
    }

    // 6. 解析完整查詢字串 (支援分號分割與書卷繼承)
    function parseQuery(queryString) {
        const parts = queryString.split(/[;；]/).map(p => p.trim()).filter(p => p.length > 0);
        const queries = [];
        let lastBookObj = null;

        for (let part of parts) {
            let parsed = parseScriptureInput(part);
            if (!parsed) {
                const parsedCV = parseChapterAndVerse(part);
                if (parsedCV && lastBookObj) {
                    parsed = {
                        eng: lastBookObj.eng,
                        short: lastBookObj.short,
                        chap: parsedCV.chap,
                        sec: parsedCV.sec,
                        bookName: lastBookObj.full
                    };
                }
            }
            if (parsed) {
                lastBookObj = BIBLE_BOOKS.find(b => b.eng === parsed.eng);
                queries.push(parsed);
            }
        }
        return queries;
    }

    // 7. FHL API 單次經文網路請求 (自動補全 "來"、處理 "上帝版" 置換，並回傳相容資料格式)
    async function fetchScripture(queryObj, version = 'unv', options = {}) {
        const fhlBook = queryObj.eng === 'Heb' ? '來' : queryObj.short;
        const qstr = `${fhlBook} ${queryObj.chap}${queryObj.sec ? ':' + queryObj.sec : ''}`;
        const apiVersion = version === 'unv_god' ? 'unv' : version;
        const apiUrl = `https://bible.fhl.net/json/qsb.php?qstr=${encodeURIComponent(qstr)}&version=${apiVersion}&gb=0`;

        const response = await fetch(apiUrl, options);
        if (!response.ok) {
            throw new Error(`HTTP 錯誤: ${response.status}`);
        }
        const data = await response.json();
        
        if (data.status !== 'success') {
            throw new Error(data.message || '聖經 API 查詢失敗');
        }

        if (!data.record || data.record.length === 0) {
            throw new Error(`查無此段經文: "${qstr}"`);
        }

        let record = data.record;
        
        // 上帝版文字置換：取代 神 為 上帝
        if (version === 'unv_god') {
            record = record.map(v => ({
                ...v,
                bible_text: v.bible_text.replace(/(?:[ 　]+|^)神/g, '上帝')
            }));
        }

        return {
            success: true,
            status: 'success',
            version: version,
            record: record,
            records: record.map(r => ({
                chap: r.chap,
                sec: r.sec,
                text: r.bible_text,
                bible_text: r.bible_text
            }))
        };
    }

    // 8. 批次查詢與回傳 (支援 Promise.all 並行載入)
    async function query(queryString, version = 'unv', options = {}) {
        const queries = parseQuery(queryString);
        if (queries.length === 0) {
            throw new Error(`無法識別經文格式: "${queryString}"`);
        }

        const fetchPromises = queries.map(async (queryObj) => {
            const res = await fetchScripture(queryObj, version, options);
            return {
                queryObj: queryObj,
                record: res.record,
                records: res.records
            };
        });

        return await Promise.all(fetchPromises);
    }

    // 暴露全域 API
    window.FhlBibleService = {
        BIBLE_BOOKS: BIBLE_BOOKS,
        chineseToArabic: chineseToArabic,
        parseChapterAndVerse: parseChapterAndVerse,
        parseScriptureInput: parseScriptureInput,
        parseQuery: parseQuery,
        fetchScripture: fetchScripture,
        query: query
    };

})(window);
