// 經文格式自動標準化工具 (BibleFormatter)
// 移植自全域 config.js，供週報系統獨立使用

const BibleFormatter = (function() {
  const BIBLE_BOOKS = {
    "創": "創世記", "創世記": "創世記",
    "出": "出埃及記", "出埃及": "出埃及記", "出埃及記": "出埃及記",
    "利": "利未記", "利未": "利未記", "利未記": "利未記",
    "民": "民數記", "民數": "民數記", "民數記": "民數記",
    "申": "申命記", "申命": "申命記", "申命記": "申命記",
    "書": "約書亞記", "約書亞": "約書亞記", "約書亞記": "約書亞記",
    "士": "士師記", "士師": "士師記", "士師記": "士師記",
    "得": "路得記", "路得": "路得記", "路得記": "路得記",
    "撒上": "撒母耳記上", "撒母耳記上": "撒母耳記上", "撒記上": "撒母耳記上", "薩上": "撒母耳記上",
    "撒下": "撒母耳記下", "撒母耳記下": "撒母耳記下", "撒記下": "撒母耳記下", "薩下": "撒母耳記下",
    "王上": "列王紀上", "列王紀上": "列王紀上", "王上": "列王紀上",
    "王下": "列王紀下", "列王紀下": "列王紀下", "王下": "列王紀下",
    "代上": "歷代志上", "歷代志上": "歷代志上", "代上": "歷代志上",
    "代下": "歷代志下", "歷代志下": "歷代志下", "代下": "歷代志下",
    "拉": "以斯拉記", "以斯拉": "以斯拉記", "以斯拉記": "以斯拉記",
    "尼": "尼希米記", "尼希米": "尼希米記", "尼希米記": "尼希米記",
    "斯": "以斯帖記", "以斯帖": "以斯帖記", "以斯帖記": "以斯帖記",
    "伯": "約伯記", "約伯": "約伯記", "約伯記": "約伯記",
    "詩": "詩篇", "詩篇": "詩篇",
    "箴": "箴言", "箴言": "箴言",
    "傳": "傳道書", "傳道": "傳道書", "傳道書": "傳道書",
    "歌": "雅歌", "雅歌": "雅歌",
    "賽": "以賽亞書", "以賽亞": "以賽亞書", "以賽亞書": "以賽亞書",
    "耶": "耶利米書", "耶利米": "耶利米書", "耶利米書": "耶利米書",
    "哀": "耶利米哀歌", "耶利米哀歌": "耶利米哀歌", "哀歌": "耶利米哀歌",
    "結": "以西結書", "以西結": "以西結書", "暗結": "以西結書",
    "但": "但以理書", "但以理": "但以理書", "但以理書": "但以理書",
    "何": "何西阿書", "何西阿": "何西阿書", "何西阿書": "何西阿書",
    "珥": "約珥書", "約珥": "約珥書", "約珥書": "約珥書",
    "摩": "阿摩司書", "阿摩司": "阿摩司書", "阿摩司書": "阿摩司書",
    "俄": "俄巴底亞書", "俄巴底亞": "俄巴底亞書", "俄巴底亞書": "俄巴底亞書",
    "拿": "約拿書", "約拿": "約拿書", "約拿書": "約拿書",
    "彌": "彌迦書", "彌迦": "彌迦書", "彌迦書": "彌迦書",
    "鴻": "那鴻書", "那鴻": "那鴻書", "那鴻書": "那鴻書",
    "哈": "哈巴谷書", "哈巴谷": "哈巴谷書", "哈巴谷書": "哈巴谷書",
    "番": "西番雅書", "西番雅": "西番雅書", "西番雅書": "西番雅書",
    "該": "哈該書", "該": "哈該書", "哈該書": "哈該書",
    "亞": "撒迦利亞書", "撒迦利亞": "撒迦利亞書", "撒迦利亞書": "撒迦利亞書",
    "瑪": "瑪拉基書", "瑪拉基": "瑪拉基書", "瑪拉基書": "瑪拉基書",

    "太": "馬太福音", "馬太": "馬太福音", "馬太福音": "馬太福音",
    "可": "馬可福音", "馬可": "馬可福音", "馬可福音": "馬可福音",
    "路": "路加福音", "路加": "路加福音", "路加福音": "路加福音",
    "約": "約翰福音", "約翰": "約翰福音", "約翰福音": "約翰福音",
    "徒": "使徒行傳", "使徒": "使徒行傳", "使徒行傳": "使徒行傳",
    "羅": "羅馬書", "羅馬": "羅馬書", "羅馬書": "羅馬書",
    "林前": "哥林多前書", "哥林多前書": "哥林多前書", "林前書": "哥林多前書",
    "林後": "哥林多後書", "哥林多後書": "哥林多後書", "林後書": "哥林多後書",
    "加": "加拉太書", "加拉太": "加拉太書", "加拉太書": "加拉太書",
    "弗": "以弗所書", "以弗所": "以弗所書", "以弗所書": "以弗所書",
    "腓": "腓立比書", "腓立比": "腓立比書", "腓立比書": "腓立比書",
    "西": "歌羅西書", "歌羅西": "歌羅西書", "歌羅西書": "歌羅西書",
    "帖前": "帖撒羅尼迦前書", "帖撒羅尼迦前書": "帖撒羅尼迦前書", "帖前書": "帖撒羅尼迦前書",
    "帖後": "帖撒羅尼迦後書", "帖撒羅尼迦後書": "帖撒羅尼迦後書", "帖後書": "帖撒羅尼迦後書",
    "提前": "提摩太前書", "提摩太前書": "提摩太前書", "提前書": "提摩太前書",
    "提後": "提摩太後書", "提摩太後書": "提摩太後書", "提後書": "提摩太後書",
    "多": "提多書", "多": "提多書", "提多書": "提多書",
    "門": "腓利門書", "腓利門": "腓利門書", "腓利門書": "腓利門書",
    "來": "希伯來書", "希伯來": "希伯來書", "希伯來書": "希伯來書",
    "雅": "雅各書", "雅各": "雅各書", "雅各書": "雅各書",
    "彼前": "彼得前書", "彼得前書": "彼得前書", "彼前書": "彼得前書",
    "彼後": "彼得後書", "彼得後書": "彼得後書", "彼後書": "彼得後書",
    "約壹": "約翰一書", "約壹書": "約翰一書", "約翰壹書": "約翰一書",
    "約一": "約翰一書", "約翰一書": "約翰一書", "約一書": "約翰一書",
    "約二": "約翰二書", "約翰二書": "約翰二書", "約二書": "約翰二書",
    "約三": "約翰三書", "約翰三書": "約翰三書", "約三書": "約翰三書",
    "猶": "猶大書", "猶大": "猶大書", "猶大書": "猶大書",
    "啟": "啟示錄", "啟示": "啟示錄", "啟示錄": "啟示錄"
  };

  function toHalfWidth(str) {
    if (!str) return '';
    return str.replace(/[\uFF01-\uFF5E]/g, function(char) {
      return String.fromCharCode(char.charCodeAt(0) - 0xfee0);
    }).replace(/\u3000/g, ' ');
  }

  function chineseToNumber(zhNum) {
    const charMap = {
      '零': 0, '〇': 0, '一': 1, '二': 2, '两': 2, '兩': 2, '三': 3, '四': 4,
      '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10,
      '廿': 20, '卅': 30, '卌': 40
    };
    zhNum = (zhNum || '').trim();
    if (!zhNum) return 0;
    if (/^\d+$/.test(zhNum)) return parseInt(zhNum, 10);

    let total = 0;
    let r = 0;
    for (let i = 0; i < zhNum.length; i++) {
      const char = zhNum[i];
      const val = charMap[char];
      if (val !== undefined) {
        if (val === 10) {
          if (r === 0) r = 1;
          total += r * 10;
          r = 0;
        } else if (val === 20 || val === 30 || val === 40) {
          total += val;
          r = 0;
        } else {
          r = val;
        }
      } else if (char === '百') {
        if (r === 0) r = 1;
        total += r * 100;
        r = 0;
      }
    }
    total += r;
    return total;
  }

  const bookRegexPart = Object.keys(BIBLE_BOOKS)
    .sort((a, b) => b.length - a.length)
    .map(k => k.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'))
    .join('|');
    
  const numClass = '[0-9０-９]+|[一二三四五六七八九十百廿卅卌]+';
  const scriptureRegex = new RegExp(
    '(' + bookRegexPart + ')\\s*(?:(' + numClass + ')(?:\\s*(?:章|:|：)\\s*|\\s+)(' + numClass + ')|([一二三四五六七八九十百廿卅卌]+)([0-9０-９]+))節?(?:\\s*(?:-|~|－|～|至|到)\\s*(' + numClass + ')節?(?![：:]))?',
    'g'
  );
  const chapSecRegex = new RegExp(
    '^\\s*(?:節\\s*)?\\s*(?:(' + numClass + ')(?:\\s*(?:章|:|：)\\s*|\\s+)(' + numClass + ')|([一二三四五六七八九十百廿卅卌]+)([0-9０-９]+))節?(?:\\s*(?:-|~|－|～|至|到)\\s*(' + numClass + ')節?(?![：:]))?\\s*$',
    'i'
  );

  function format(rawText) {
    if (!rawText) return '';
    const tokens = rawText.split(/([;；,，、\n\r]+)/);
    let currentBook = null;
    
    for (let i = 0; i < tokens.length; i += 2) {
      const token = tokens[i];
      if (!token) continue;
      
      const bookMatch = token.match(scriptureRegex);
      if (bookMatch) {
        const singleBookMatch = token.match(new RegExp('(' + bookRegexPart + ')'));
        if (singleBookMatch) {
          const bookName = singleBookMatch[1];
          currentBook = BIBLE_BOOKS[bookName] || bookName;
        }
        tokens[i] = token.replace(scriptureRegex, function(match, book, chapA, secA, chapB, secB, endSec) {
          const fullBook = BIBLE_BOOKS[book] || book;
          const chap = chapA || chapB;
          const sec = secA || secB;
          
          const chapNum = chineseToNumber(toHalfWidth(chap));
          const secNum = chineseToNumber(toHalfWidth(sec));
          
          let formatted = `${fullBook}${chapNum}:${secNum}`;
          if (endSec) {
            const endSecNum = chineseToNumber(toHalfWidth(endSec));
            formatted += `-${endSecNum}`;
          }
          return formatted;
        });
      } else if (currentBook) {
        const match = token.match(chapSecRegex);
        if (match) {
          const chap = match[1] || match[3];
          const sec = match[2] || match[4];
          const endSec = match[5];
          
          const chapNum = chineseToNumber(toHalfWidth(chap));
          const secNum = chineseToNumber(toHalfWidth(sec));
          
          let formatted = `${chapNum}:${secNum}`;
          if (endSec) {
            const endSecNum = chineseToNumber(toHalfWidth(endSec));
            formatted += `-${endSecNum}`;
          }
          
          const leadSpace = token.match(/^\s*/)[0];
          const trailSpace = token.match(/\s*$/)[0];
          tokens[i] = leadSpace + formatted + trailSpace;
        }
      }
    }
    return tokens.join('');
  }

  return { format, bookRegexPart, BIBLE_BOOKS };
})();

window.BibleFormatter = BibleFormatter;
