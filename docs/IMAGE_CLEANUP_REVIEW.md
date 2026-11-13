# Image cleanup review — no files deleted

Content-image delivery and upload controls have been removed. The files below remain on disk.
Source references alone cannot establish database ownership: production databases were not available.
Do not bulk-delete until production ItemDefinition.image_path and User.userImage references have been normalized and checked.
The default avatar is retained. Item icons may be legacy/shared assets; ownership must be confirmed.

| File | Bytes | Proposed handling |
| --- | ---: | --- |
| `static/banners/banner1.jpg` | 675399 | Candidate only; verify database/shared references and approve deletion |
| `static/banners/banner2.jpg` | 80694 | Candidate only; verify database/shared references and approve deletion |
| `static/banners/banner3.jpg` | 11489 | Candidate only; verify database/shared references and approve deletion |
| `static/images/1_bionic-eye.png` | 18489 | Candidate only; verify database/shared references and approve deletion |
| `static/images/1_skull.png` | 25889 | Candidate only; verify database/shared references and approve deletion |
| `static/images/2_1000005695.jpg` | 2857888 | Candidate only; verify database/shared references and approve deletion |
| `static/images/2_1000005925.jpg` | 5305541 | Candidate only; verify database/shared references and approve deletion |
| `static/images/2_boots.png` | 17548 | Candidate only; verify database/shared references and approve deletion |
| `static/images/4_33 Funny Memes & Pics to Feed Your Humor Appetite _ Team Jimmy Joe.jpeg` | 39283 | Candidate only; verify database/shared references and approve deletion |
| `static/images/4_Couple Goals_333 #marriedlife #MillenialMOM #potterhead.jpeg` | 21760 | Candidate only; verify database/shared references and approve deletion |
| `static/images/4_завантаження.jpeg` | 4621 | Candidate only; verify database/shared references and approve deletion |
| `static/images/background1left.jpg` | 67891 | Candidate only; verify database/shared references and approve deletion |
| `static/images/default_avatar.png` | 20559 | Keep: default profile picture |
| `static/images/logo.png` | 307893 | Candidate only; verify database/shared references and approve deletion |
| `static/images/logo34.png` | 57309 | Candidate only; verify database/shared references and approve deletion |
| `static/images/logo35.png` | 57309 | Candidate only; verify database/shared references and approve deletion |
| `static/uploads/avatars/user3_WhatsApp_Image_2025-12-26_at_17.59.35.jpeg` | 261763 | Keep pending production reference/ownership check |

All listed deletions require approval. No shared assets, defaults, or unknown-owner uploads are approved for deletion.
Automatic orphan scans at application startup have been removed. Individual replacement, removal, and account deletion perform cleanup only after a successful commit and only with zero remaining user references.
