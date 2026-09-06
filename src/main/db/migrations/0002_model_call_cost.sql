ALTER TABLE model_calls
  ADD COLUMN cost_status TEXT NOT NULL DEFAULT 'UNKNOWN'
  CHECK (cost_status IN ('ESTIMATED','UNKNOWN'));

ALTER TABLE model_calls ADD COLUMN cost_currency TEXT;
ALTER TABLE model_calls ADD COLUMN input_rate_minor_per_million INTEGER;
ALTER TABLE model_calls ADD COLUMN output_rate_minor_per_million INTEGER;

CREATE INDEX idx_model_calls_provider_currency
  ON model_calls(provider, cost_currency, created_at);
