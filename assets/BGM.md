# BGM 연결 완료

사용자가 제공한 `Born Hater - Epik High (inst with hook ver.).mp3`를 `assets/bgm.mp3`에 복사했다. YouTube 링크에서 파일을 추출하거나 다운로드하지 않았다.

현재 화면을 유지한다. HATE에서 Web Audio를 준비하고 BGM을 0.18 음량으로 반복 재생한다. 펀치·균열 효과음은 별도 채널을 사용하며 음악을 중단하지 않는다. 정지, Escape, 페이지 종료 시 오디오와 카메라가 중지된다.

공개 버전 10의 배포 파일 네 개가 로컬 원본과 일치했다. 실제 브라우저에서 audio=ready, bgm=playing, 카메라 active를 확인했고 정지 후 bgm=stopped, HATE 재시작 후 bgm=playing을 확인했다. 단위 검사 5개가 음량, 반복 및 별도 효과음 채널을 검증했다. 스피커 소리를 직접 청취한 검증은 아니다.

TouchDesigner의 로컬 웹 서버에도 BGM 경로를 추가하고 BORN_HATER_WEB_BGM.toe로 저장했다. localhost:9983/assets/bgm.mp3 응답 200 audio/mpeg와 원본 해시 일치를 확인했다.
