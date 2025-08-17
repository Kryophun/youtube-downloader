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
    url: bestAudio.url ? "Direct URL" : "Needs deciphering",
    actualUrl: bestAudio.url ? bestAudio.url.substring(0, 100) + "..." : "null"
  });

  // Create filename with .mp3 extension
  const filename = getCompatibleFilename(title);
  const filenameOutput = `${filename}.mp3`;

  console.log(`YT Downloader: Downloading as: ${filenameOutput}`);
  console.log(`YT Downloader: Full audio URL:`, bestAudio.url);

  // Send download request to background script
  try {
    // First establish connection to background script
    const port = chrome.runtime.connect({ name: "process-single" });

    // Send the download request
    port.postMessage({
      type: "audio",
      urls: {
        video: "", // Not needed for audio-only
        audio: bestAudio.url
      },
      filenameOutput: filenameOutput,
      videoId: videoId
    });

    console.log(`YT Downloader: Download request sent successfully`);

    // Show a simple notification
    console.log(`YT Downloader: Starting download of "${filenameOutput}"`);
  } catch (error) {
    console.error(`YT Downloader: Failed to start download:`, error);
  }
}
