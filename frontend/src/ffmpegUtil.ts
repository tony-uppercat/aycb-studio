/**
 * Get the duration of a video file in seconds.
 * Uses the native HTML5 video element.
 */
export function getVideoDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(video.src);
      resolve(video.duration);
    };
    video.onerror = () => {
      URL.revokeObjectURL(video.src);
      reject(new Error("Could not load video metadata"));
    };
    video.src = URL.createObjectURL(file);
  });
}
