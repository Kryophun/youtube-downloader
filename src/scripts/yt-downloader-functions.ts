import type { AdaptiveFormatItem, FormatItem, PlayerResponse } from "./types";

export async function getRemote(url: string): Promise<string> {
  const response = await fetch(url);
  return response.text();
}

const gRegex = {
  videoData: /ytInitialPlayerResponse\s*=\s*({.+?})\s*;\s*(?:var\s+meta|<\/script|\n)/,
  playlistData: /ytInitialData\s*=\s*({.+?})\s*;/,
  playerData: /set\(({.+?})\);/
};

function getStringBetween(
  string: string,
  needleStart: string,
  needleEnd?: string,
  offsetStart = 0,
  offsetEnd = 0
): string {
  const x = string.indexOf(needleStart);
  const y = needleEnd ? string.indexOf(needleEnd, x) : string.length;
  return string.substring(x + needleStart.length + offsetEnd, y + offsetStart);
}

async function getAdaptiveFormats({
  videoData,
  playerData
}: {
  videoData: PlayerResponse;
  playerData: { PLAYER_JS_URL: string };
}) {
  const getUrlFromSignature = (signatureCipher: string): string => {
    const searchParams = new URLSearchParams(signatureCipher);
    const [url, signature, sp] = [searchParams.get("url"), searchParams.get("s"), searchParams.get("sp")];

    return `${url}&${sp}=${decipher(signature)}`;
  };

  // eslint-disable-next-line @typescript-eslint/ban-types
  const getDecipherFunction = (string: string): Function => {
    const js = string.replace("var _yt_player={}", "");
    const top = getStringBetween(js, `a=a.split("")`, "};", 1, -28);
    const beginningOfFunction =
      "var " + getStringBetween(top, `a=a.split("")`, "(", 10, 1).split(".")[0] + "=";
    const side = getStringBetween(js, beginningOfFunction, "};", 2, -beginningOfFunction.length);
    return eval(side + top);
  };

  const baseContent = await getRemote(`https://www.youtube.com${playerData.PLAYER_JS_URL}`);
  const decipher = getDecipherFunction(baseContent);

  const {
    streamingData: { adaptiveFormats }
  } = videoData;

  adaptiveFormats.forEach(format => {
    format.url = getUrlFromSignature(format.signatureCipher);
    delete format.signatureCipher;
  });

  return adaptiveFormats;
}

async function getDownloadableLinks(formats: AdaptiveFormatItem[] | FormatItem[]) {
  const downloadableLinks = [];

  for (const format of formats) {
    try {
      const res = await fetch(format.url);
      if (res.ok) {
        downloadableLinks.push(format);
      }
      // eslint-disable-next-line no-empty
    } catch {}
  }
  return downloadableLinks;
}

export async function getVideoData(htmlYouTubePage: string): Promise<PlayerResponse> {
  console.log("getVideoData: Starting video data extraction");

  // Extract video data with better error handling and logging
  const videoDataMatch = htmlYouTubePage.match(gRegex.videoData);
  if (!videoDataMatch) {
    console.error("getVideoData: Failed to match ytInitialPlayerResponse regex");
    console.log("getVideoData: HTML page length:", htmlYouTubePage.length);
    console.log("getVideoData: First 500 chars:", htmlYouTubePage.substring(0, 500));
    throw new Error("Could not extract video data from YouTube page");
  }

  console.log("getVideoData: Successfully matched ytInitialPlayerResponse");
  console.log("getVideoData: Raw video data length:", videoDataMatch[1].length);

  let videoData: PlayerResponse;
  try {
    videoData = JSON.parse(videoDataMatch[1]);
    console.log("getVideoData: Successfully parsed video data JSON");
    console.log("getVideoData: Video title:", videoData.videoDetails?.title);
    console.log("getVideoData: Video ID:", videoData.videoDetails?.videoId);
  } catch (error) {
    console.error("getVideoData: Failed to parse video data JSON:", error);
    console.log("getVideoData: Raw JSON data:", videoDataMatch[1].substring(0, 200) + "...");
    throw new Error("Could not parse video data JSON");
  }

  const playabilityStatus = videoData.playabilityStatus?.status;
  console.log("getVideoData: Playability status:", playabilityStatus);

  const isUnplayable = playabilityStatus !== "OK";
  if (isUnplayable) {
    console.warn("getVideoData: Video is unplayable, reason:", videoData.playabilityStatus?.reason);
    return videoData;
  }

  const formats = videoData.streamingData?.adaptiveFormats || videoData.streamingData?.formats;
  console.log("getVideoData: Found formats count:", formats?.length || 0);

  if (!formats || formats.length === 0) {
    console.warn("getVideoData: No streaming formats found");
    return videoData;
  }

  const isHasStreamingUrls = Boolean(formats[0]?.url);
  console.log("getVideoData: Has streaming URLs:", isHasStreamingUrls);

  if (isHasStreamingUrls) {
    console.log("getVideoData: Using direct streaming URLs");
    videoData.streamingData.adaptiveFormats = await getDownloadableLinks(formats);
    return videoData;
  }

  // Extract player data with better error handling and logging
  console.log("getVideoData: Need to decipher signatures, extracting player data");
  const playerDataMatch = htmlYouTubePage.match(gRegex.playerData);
  if (!playerDataMatch) {
    console.error("getVideoData: Failed to match player data regex");
    console.log("getVideoData: Searching for player data patterns in HTML...");
    throw new Error("Could not extract player data from YouTube page");
  }

  console.log("getVideoData: Successfully matched player data");

  let playerData;
  try {
    playerData = JSON.parse(playerDataMatch[1]);
    console.log("getVideoData: Successfully parsed player data JSON");
    console.log("getVideoData: Player JS URL:", playerData.PLAYER_JS_URL);
  } catch (error) {
    console.error("getVideoData: Failed to parse player data JSON:", error);
    console.log("getVideoData: Raw player data:", playerDataMatch[1].substring(0, 200) + "...");
    throw new Error("Could not parse player data JSON");
  }

  console.log("getVideoData: Starting adaptive formats extraction with signature deciphering");
  videoData.streamingData.adaptiveFormats = await getAdaptiveFormats({
    videoData,
    playerData
  });

  console.log(
    "getVideoData: Successfully extracted video data with",
    videoData.streamingData.adaptiveFormats?.length || 0,
    "adaptive formats"
  );

  return videoData;
}
