# 복싱장 펀치 배경

현재 공개 버전 19는 `assets/boxing-ring-game.png`를 사용한다. 원본 복싱장과 사용자가 보낸 게임 화면을 참고해 ImageGen 내장 도구로 단순한 3D 게임풍 배경을 만들었다. 생성 프롬프트는 BOXING_GAME_GENERATION.md에 있다. 아래 사진 원본은 보존했다.

원본 수신: /Users/jeongmin/Downloads/_.jpeg — 736×736 JPEG, 92,011바이트. assets/boxing-ring.jpg로 내용 변경 없이 복사했다.

앞으로 펀치할 때 복싱 링 배경으로 전환하고 진행 중인 픽셀 폭발은 중지한다. 주먹만 쥐는 작은 균열에서는 배경을 바꾸지 않는다. 어두운 오버레이와 밝은 텍스트를 사용한다. 가운데 손가락은 픽셀 폭발 배경, HATE는 기본 배경으로 전환한다. 카메라, BGM PLAY/MUTE, 효과음은 기존 동작을 유지한다.

공개/로컬 실행 반영과 검증은 td/boxing-background-verification.json 및 td/README.md에 기록한다. 이전 원본 파일 대기 기록은 td/boxing-background-preparation.json에 남아 있다.
