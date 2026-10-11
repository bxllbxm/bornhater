# 이전 TouchDesigner 연동 소스

현재 사이트는 브라우저에서 MediaPipe 손 추적을 처리하므로 방문자와 개발자가 TouchDesigner를 설치할 필요가 없습니다.

이 폴더의 Python 코드는 이전 TouchDesigner 실험의 소스입니다. `gestures.py`는 제스처 판정, `engine.py`는 이벤트·메모리 기반 미리보기 전송, `site_callbacks.py`와 `mediapipe_callbacks.py`는 TD DAT 콜백입니다. 설치·진단·수리 스크립트는 당시 프로젝트의 `/project1/born_hater` 노드 구조를 가정합니다.

대용량 `.toe`/`.tox`, 웹캠 캡처·손 관절 좌표·진단 JSON은 로컬에 보관하며 GitHub에는 올리지 않습니다. 이 Python 소스만으로 이전 TD 프로젝트를 완전히 재구성할 수는 없습니다. 현재 공유 웹 실행에 필요한 파일은 저장소 루트와 `assets/`, `vendor/`에 모두 있습니다.
