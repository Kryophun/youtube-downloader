import { getVideoData } from "./yt-downloader-functions";
import { gCancelControllers, getIsDownloadable } from "./yt-downloader-content-script-initialize";
import { getCompatibleFilename } from "./utils";
import type { PlayerResponse } from "./types";

export async function handleVideo(): Promise<void> {
  console.log(`YT Downloader: handleVideo()`);
  const getHtml = async () => {
    const abortController = new AbortController();
    gCancelControllers.push(abortController);
    console.log(`Fetching html for ${location.href}`);
    const response = await fetch(location.href, {
      signal: abortController.signal
    });
    return response.text();
  };

  const videoData = await getVideoData(await getHtml());
  console.log(`YT Downloader: videoData`, videoData);

  // Skip UI creation and download audio directly
  await downloadAudioDirectly(videoData);
}

async function downloadAudioDirectly(videoData: PlayerResponse): Promise<void> {
  console.log(`YT Downloader: Starting automatic audio download`);

  // Check if video is downloadable
  if (!getIsDownloadable(videoData)) {
    console.log(`YT Downloader: Video is not downloadable`);
    return;
  }

  // Get video details
  const { videoId, title } = videoData.videoDetails;
  console.log(`YT Downloader: Downloading audio for: ${title}`);

  // Find the best audio format (highest bitrate)
  // Check both adaptiveFormats and regular formats for audio with URLs
  let formats = videoData.streamingData?.adaptiveFormats || [];

  // Filter for audio-only formats or video formats with audio that have URLs
  let audioFormats = formats.filter(format => {
    const hasUrl = !!format.url;
    const isAudio = format.mimeType?.startsWith("audio");
    const formatObj = format as Record<string, unknown>;
    const hasAudioProperties = !!(
      formatObj.audioQuality ||
      formatObj.audioSampleRate ||
      formatObj.audioChannels
    );
    return hasUrl && (isAudio || hasAudioProperties);
  });

  // If no audio formats with URLs in adaptiveFormats, try regular formats
  if (audioFormats.length === 0) {
    console.log("YT Downloader: No audio with URLs in adaptiveFormats, checking regular formats...");
    formats = videoData.streamingData?.formats || [];
    audioFormats = formats.filter(format => {
      const hasUrl = !!format.url;
      const isAudio = format.mimeType?.startsWith("audio");
      const formatObj = format as Record<string, unknown>;
      const hasAudioProperties = !!(
        formatObj.audioQuality ||
        formatObj.audioSampleRate ||
        formatObj.audioChannels
      );
      return hasUrl && (isAudio || hasAudioProperties);
    });
  }

  console.log(
    "YT Downloader: Using",
    formats === videoData.streamingData?.adaptiveFormats ? "adaptiveFormats" : "formats",
    "array"
  );

  // If still no audio formats with URLs, fall back to all audio formats (for deciphering)
  if (audioFormats.length === 0) {
    console.log("YT Downloader: No audio with direct URLs found, using all audio formats for deciphering...");
    audioFormats = formats.filter(format => {
      const isAudio = format.mimeType?.startsWith("audio");
      const formatObj = format as Record<string, unknown>;
      const hasAudioProperties = !!(
        formatObj.audioQuality ||
        formatObj.audioSampleRate ||
        formatObj.audioChannels
      );
      return isAudio || hasAudioProperties;
    });
  }

  if (audioFormats.length === 0) {
    console.log(`YT Downloader: No audio formats found`);
    return;
  }

  console.log(`YT Downloader: Found ${audioFormats.length} audio formats`);

  // Debug: Log all audio formats to see their structure
  audioFormats.forEach((format, index) => {
    console.log(`YT Downloader: Audio format ${index}:`, {
      bitrate: format.bitrate,
      mimeType: format.mimeType,
      hasUrl: !!format.url,
      hasSignatureCipher: !!format.signatureCipher,
      url: format.url,
      signatureCipher: format.signatureCipher
    });
  });

  // Sort by bitrate (highest first) and get the best one
  audioFormats.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
  const bestAudio = audioFormats[0];

  console.log(`YT Downloader: Selected audio format:`, {
    bitrate: bestAudio.bitrate,
    mimeType: bestAudio.mimeType,
    itag: bestAudio.itag,
    url: bestAudio.url ? "Direct URL" : "Needs deciphering",
    hasSignatureCipher: !!bestAudio.signatureCipher,
    actualUrl: bestAudio.url ? bestAudio.url.substring(0, 100) + "..." : "null"
  });

  // Check if we need to decipher the signature
  if (!bestAudio.url && bestAudio.signatureCipher) {
    console.log(`YT Downloader: Format requires signature deciphering:`, bestAudio.signatureCipher);
    console.log(`YT Downloader: This extension doesn't support signature deciphering yet - YouTube has blocked direct URL access`);
    return;
  }

  if (!bestAudio.url) {
    console.log(`YT Downloader: No URL available for selected format`);
    return;
  }

  // Create filename with .mp3 extension
  const filename = getCompatibleFilename(title);
  const filenameOutput = `${filename}.mp3`;

  console.log(`YT Downloader: Downloading as: ${filenameOutput}`);
  console.log(`YT Downloader: Full audio URL:`, bestAudio.url);
  console.log(`YT Downloader: Audio URL length:`, bestAudio.url?.length || 0);
  console.log(`YT Downloader: Audio URL valid?:`, !!(bestAudio.url && bestAudio.url.startsWith("https://")));

  // Try downloading directly from content script (same origin as YouTube)
  try {
    console.log(`YT Downloader: Attempting direct download from content script`);

    const response = await fetch(bestAudio.url, {
      method: "GET",
      headers: {
        "User-Agent": navigator.userAgent
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    console.log(`YT Downloader: Fetch successful, creating blob`);
    const blob = await response.blob();
    console.log(`YT Downloader: Blob created, size:`, blob.size);

    // Create download link and trigger download
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filenameOutput;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    console.log(`YT Downloader: Download triggered successfully for "${filenameOutput}"`);
  } catch (directDownloadError) {
    console.log(`YT Downloader: Direct download failed:`, directDownloadError);
    console.log(`YT Downloader: Falling back to background script method`);

    // Fallback to background script method
    const port = chrome.runtime.connect({ name: "process-single" });

    const downloadRequest = {
      type: "audio",
      urls: {
        video: "", // Not needed for audio-only
        audio: bestAudio.url
      },
      filenameOutput: filenameOutput,
      videoId: videoId
    };

    console.log(`YT Downloader: Sending download request to background:`, downloadRequest);
    port.postMessage(downloadRequest);

    port.onMessage.addListener(response => {
      console.log(`YT Downloader: Background script response:`, response);
    });

    port.onDisconnect.addListener(() => {
      console.log(`YT Downloader: Port disconnected`);
      if (chrome.runtime.lastError) {
        console.error(`YT Downloader: Port error:`, chrome.runtime.lastError);
      }
    });
  }
}
