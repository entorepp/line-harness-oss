UPDATE forms
SET
  locale = 'ja',
  translation_group_id = '5a9ad125-9f3c-4a7d-b3fe-22f6cb430daa',
  submit_button_label = '送信',
  success_title = '送信が完了しました',
  success_description = 'ご回答ありがとうございます。内容を確認してご連絡します。'
WHERE id = '5a9ad125-9f3c-4a7d-b3fe-22f6cb430daa';

UPDATE forms
SET
  locale = 'en',
  translation_group_id = '5a9ad125-9f3c-4a7d-b3fe-22f6cb430daa',
  submit_button_label = 'Submit',
  success_title = 'Your response has been submitted',
  success_description = 'Thank you for your response. We will review it and get back to you.'
WHERE id = 'fdbc9106-9b21-43ac-b840-52d741242a56';

UPDATE forms
SET
  locale = 'ko',
  translation_group_id = '5a9ad125-9f3c-4a7d-b3fe-22f6cb430daa',
  submit_button_label = '제출',
  success_title = '제출이 완료되었습니다',
  success_description = '응답해 주셔서 감사합니다. 내용을 확인한 뒤 연락드리겠습니다.'
WHERE id = 'cf538373-a378-42a3-9620-35d5b3985214';

UPDATE forms
SET
  locale = 'zh-TW',
  translation_group_id = '5a9ad125-9f3c-4a7d-b3fe-22f6cb430daa',
  submit_button_label = '送出',
  success_title = '表單已送出',
  success_description = '感謝您的填寫，我們會確認內容後再與您聯繫。'
WHERE id = '7d7c9b75-5a6b-4bc7-9811-90b78377eaeb';
