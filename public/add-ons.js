function copyURL(link) {
  const url = link;
  navigator.clipboard.writeText(url)
    .then(() => newNotify('URL kopyalandı!'))
    .catch(error => console.error("Failed to copy URL:", error));
}
  
function newNotify(text) {
  const alertElement = document.querySelector(".alert");
  if (!alertElement) return;
  alertElement.textContent = text;
  alertElement.classList.remove("hidden");
  alertElement.classList.add("show");
  setTimeout(() => {
    alertElement.classList.remove("show");
    alertElement.classList.add("hidden");
  }, 2500);
}

function resizeVideos() {
  const videoContainer = document.getElementById('videoDiv') || document.getElementById('video-container');
  if (!videoContainer) return;

  const videos = videoContainer.querySelectorAll('video');
  if (!videos || videos.length === 0) return;

  const numParticipants = videos.length;

  if (numParticipants === 1) {
    setVideoLayout(videos[0], 12);
  } else if (numParticipants === 2) {
    setVideoLayoutForEach(videos, 6);
  } else if (numParticipants === 3) {
    setVideoLayoutForEach(videos, 4);
  } else {
    setVideoLayoutForEach(videos, 3);
  }
}

function setVideoLayout(video, colsPerParticipant) {
  if (!video) return;
  const cardWrapper = video.closest('.video-card-wrapper');
  if (cardWrapper) {
    cardWrapper.className = `col-md-${colsPerParticipant} video-card-wrapper`;
  }
}

function setVideoLayoutForEach(videos, colsPerParticipant) {
  videos.forEach(video => setVideoLayout(video, colsPerParticipant));
}
