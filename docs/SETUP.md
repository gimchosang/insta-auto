# 설정 가이드

순서대로 따라오세요. **1~2단계는 인스타 계정 없이도 지금 바로 할 수 있습니다.**

---

## 1단계 · GitHub 올리기 (10분)

1. [github.com](https://github.com) 가입
2. 우측 상단 `+` → **New repository**
   - 이름: `insta-auto`
   - **Public 선택** ← 중요합니다. 퍼블릭이어야 Actions 실행 시간이 무제한 무료입니다
   - Create repository
3. 만들어진 페이지에서 **uploading an existing file** 클릭 → `insta-auto` 폴더 안의 파일을 전부 끌어다 놓기 → Commit

> 토큰은 코드가 아니라 GitHub Secrets 에 저장되므로 퍼블릭 레포여도 노출되지 않습니다.

### Pages 켜기

**Settings → Pages**

- Source: `Deploy from a branch`
- Branch: `main` / 폴더는 **`/docs`** 선택 → Save

1~2분 뒤 주소가 표시됩니다. 이 주소를 적어두세요:

```
https://<깃허브아이디>.github.io/insta-auto
```

인스타 API 는 이미지가 **공개 URL** 에 있어야만 발행을 받아줍니다. 이 주소가 그 역할을 합니다.

### 변수 등록

**Settings → Secrets and variables → Actions → Variables 탭 → New repository variable**

| Name | Value |
|---|---|
| `PAGES_BASE_URL` | 위에서 적어둔 주소 |

---

## 2단계 · 미리보기 돌려보기 (5분)

여기서 카드가 실제로 어떻게 나오는지 확인합니다. **인스타 계정이 없어도 됩니다.**

1. [Google AI Studio](https://aistudio.google.com/apikey) 에서 **Create API key** (무료, 카드 등록 없음)
2. **Settings → Secrets and variables → Actions → Secrets 탭 → New repository secret**
   - Name: `GEMINI_API_KEY`
   - Secret: 복사한 키
3. **Actions 탭 → 좌측 "미리보기" → Run workflow**
   - 계정: `all` 또는 하나 선택
   - 개수: `3` 정도로 해서 문구 편차를 보세요
4. 3~4분 뒤 실행을 클릭하면
   - **요약 화면에 생성된 문구**가 보이고
   - 맨 아래 **Artifacts → preview-cards** 에서 이미지를 받을 수 있습니다

마음에 안 들면 `accounts/*.json` 의 `persona` 를 고치고 다시 돌리세요. 이 단계에서 톤을 잡아두는 게 나중에 훨씬 편합니다.

---

## 3단계 · 인스타 계정 준비 (일주일, 계정당 6분)

### 계정 만들기
- 계정마다 다른 이메일 (Gmail 은 `내주소+univ@gmail.com` 처럼 `+단어` 를 붙이면 같은 편지함으로 옵니다)
- **하루에 몰아서 만들지 마세요.** 2~3일 간격을 두세요

### 프로페셔널 전환
```
프로필 → 우측 상단 ☰ → 설정 및 개인정보
      → 계정 유형 및 도구 → 프로페셔널 계정으로 전환
      → 카테고리 선택 → 비즈니스
```
- 무료이고 되돌릴 수 있습니다
- **공개 계정이어야 합니다.** 비공개는 전환이 안 됩니다

### 워밍업 (계정당 하루 30초 × 5일)
프로필을 채우고, 미리보기로 뽑아둔 카드를 손으로 올리고, 관련 계정을 팔로우하세요.
갓 만든 계정이 곧바로 API 로만 활동하면 스팸 패턴으로 읽힙니다.

이 기간 동안 `accounts/*.json` 의 `enabled` 는 `false` 로 두세요.

---

## 4단계 · Meta 토큰 발급 (첫 계정 40~60분, 이후 계정당 5분)

**여기가 가장 까다롭습니다.** Meta 콘솔은 UI가 자주 바뀌니, 화면이 아래 설명과 다르면 **캡처해서 보여주세요.** 바로 짚어드립니다.

### 4-1. 앱 만들기
1. [developers.facebook.com](https://developers.facebook.com) → 페이스북 계정으로 로그인 → 개발자 등록
2. **내 앱 → 앱 만들기**
3. 사용 사례에서 **"Instagram 계정 액세스 및 관리"** 계열을 선택
   (버전에 따라 앱 유형에서 **비즈니스** 를 고르는 화면일 수 있습니다)
4. 앱 이름은 아무거나 (예: `insta-auto`)

### 4-2. Instagram 제품 추가
1. 좌측 메뉴 **제품 추가** → **Instagram** → 설정
2. **"Instagram 로그인으로 API 설정"** 쪽을 고르세요
   → 페이스북 페이지를 안 만들어도 되는 경로입니다
3. 리디렉션 URI 를 요구하면 아무 https 주소나 넣어도 됩니다
   (예: `https://<깃허브아이디>.github.io/insta-auto/`)

### 4-3. 인스타 계정을 앱에 연결
1. Instagram 설정 화면의 **비즈니스 로그인 설정 / 앱 역할** 에서 인스타 계정을 추가
2. **인스타그램 앱에서 초대를 수락해야 합니다**
   ```
   설정 및 개인정보 → 앱 및 웹사이트 → 테스터 초대 → 수락
   ```
   (경로는 버전에 따라 `웹사이트 권한` 아래일 수 있습니다)

### 4-4. 토큰 생성
Instagram → API 설정 화면에 **액세스 토큰 생성** 버튼이 있습니다.
계정을 고르고 생성하면 긴 문자열이 나옵니다. 이게 장기 토큰입니다.

> 이 토큰은 **60일** 짜리입니다. 갱신은 자동화해두었으니 지금은 신경 쓰지 마세요.

### 4-5. 사용자 ID 확인
브라우저 주소창에 아래를 넣고 엔터 (`토큰` 자리에 방금 복사한 값):

```
https://graph.instagram.com/v23.0/me?fields=id,username&access_token=토큰
```

```json
{ "id": "17841400000000000", "username": "내계정" }
```

이 `id` 가 `IG_USER_ID_*` 에 넣을 값입니다.

### 4-6. 시크릿 등록
**Settings → Secrets and variables → Actions → Secrets**

계정별로 2개씩 (이름은 `accounts/*.json` 의 `secrets` 항목과 정확히 같아야 합니다):

| 계정 | 토큰 | 사용자 ID |
|---|---|---|
| 대학생 공감 | `IG_TOKEN_UNIV_HUMOR` | `IG_USER_ID_UNIV_HUMOR` |
| 직장인 공감 | `IG_TOKEN_OFFICE_HUMOR` | `IG_USER_ID_OFFICE_HUMOR` |
| 자취 생활 | `IG_TOKEN_SOLO_LIFE` | `IG_USER_ID_SOLO_LIFE` |
| 성북 대학가 | `IG_TOKEN_SEONGBUK_CAMPUS` | `IG_USER_ID_SEONGBUK_CAMPUS` |

---

## 5단계 · 지역 계정 소재 키 (5분)

성북 대학가 계정을 쓸 때만 필요합니다.

1. [서울 열린데이터광장](https://data.seoul.go.kr) 가입 → **마이페이지 → 인증키 신청** (무료, 즉시 발급)
2. 시크릿 추가: `SEOUL_API_KEY`

---

## 6단계 · 가동 (2분)

1. `accounts/*.json` 에서 준비된 계정의 `enabled` 를 `true` 로 변경
2. **Actions 탭 → "매일 발행" → Run workflow → force 체크** 후 실행해서 한 번 테스트
3. 성공하면 이후로는 `publishAt` 시각에 알아서 돕니다

---

## 7단계 · 토큰 자동 갱신 (선택, 5분)

건너뛰면 60일마다 손으로 재발급해야 합니다. 5분 투자할 가치가 있습니다.

1. GitHub **Settings(내 계정) → Developer settings → Personal access tokens → Fine-grained tokens**
2. **Generate new token**
   - Repository access: `insta-auto` 만 선택
   - Permissions → Repository permissions → **Secrets: Read and write**
   - 만료: 1년
3. 발급된 토큰을 레포 시크릿에 **`GH_PAT`** 로 저장

이제 매월 1일·15일에 자동 갱신되고, 실패하면 이슈가 올라옵니다.

---

## 문제가 생기면

| 증상 | 원인 |
|---|---|
| `이미지를 가져올 수 없습니다` 류 오류 | Pages 가 아직 안 켜졌거나 `PAGES_BASE_URL` 오타 |
| `code 190` | 토큰 만료 또는 무효 → 재발급 |
| `code 200` / 권한 오류 | 계정이 프로페셔널이 아니거나 앱 연결이 안 됨 |
| 카드에 글자가 네모(□)로 나옴 | 한글 폰트 미설치 — 워크플로에 이미 포함돼 있으니 재실행 |
| 지역 계정이 계속 건너뜀 | 해당 기간 성북구 행사가 없음. 정상 동작입니다 |
| 문구가 어색함 | `accounts/*.json` 의 `persona.voice` 와 `avoid` 를 구체적으로 고치세요 |

실패한 워크플로의 **로그를 캡처해서 보여주시면** 원인을 짚어드립니다.
