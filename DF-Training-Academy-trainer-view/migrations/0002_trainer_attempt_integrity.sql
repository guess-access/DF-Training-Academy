-- Apply to existing D1 databases after the Trainer View tables exist:
-- npx wrangler d1 execute df-training-academy --remote --file=migrations/0002_trainer_attempt_integrity.sql

CREATE TRIGGER IF NOT EXISTS trg_attempts_delete_answers
AFTER DELETE ON attempts
BEGIN
  DELETE FROM attempt_answers WHERE attempt_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_final_quiz_delete_certificate
AFTER DELETE ON quizzes
WHEN OLD.quiz_id = 'quiz_final'
BEGIN
  DELETE FROM certificates WHERE user_id = OLD.user_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_attempts_enforce_limit
BEFORE INSERT ON attempts
WHEN NEW.source IS NULL
  AND COALESCE((SELECT max_attempts FROM quiz_policy WHERE quiz_id = NEW.quiz_id), 0) > 0
  AND (SELECT COUNT(*) FROM attempts
       WHERE user_id = NEW.user_id AND quiz_id = NEW.quiz_id
         AND (source IS NULL OR source != 'admin-edit'))
      >= (SELECT max_attempts FROM quiz_policy WHERE quiz_id = NEW.quiz_id)
BEGIN
  SELECT RAISE(ABORT, 'Attempt limit reached. Ask your trainer to reset your attempt.');
END;
