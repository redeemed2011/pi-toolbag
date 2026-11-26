package main

type decideInput struct {
	Config          fallbackConfig `json:"config"`
	Current         string         `json:"current"`
	Error           failoverError  `json:"error"`
	Attempted       []string       `json:"attempted"`
	RemainingBudget float64        `json:"remainingBudget"`
	Blocked         []string       `json:"blocked"`
}

type fallbackConfig struct {
	Enabled bool            `json:"enabled"`
	Chains  []fallbackChain `json:"chains"`
}

type fallbackChain struct {
	Models []string `json:"models"`
}

type decision struct {
	Action         string   `json:"action"`
	Next           string   `json:"next,omitempty"`
	Reason         string   `json:"reason"`
	Classification string   `json:"classification,omitempty"`
	Attempted      []string `json:"attempted,omitempty"`
}

func decideFailover(input decideInput) decision {
	if !input.Config.Enabled {
		return decision{Action: "none", Reason: "disabled"}
	}
	if !validKey(input.Current) {
		return decision{Action: "none", Reason: "invalid-current"}
	}
	if input.RemainingBudget <= 0 {
		return decision{Action: "none", Reason: "budget-exhausted"}
	}
	class := classifyError(input.Error)
	if !isFailoverWorthy(class) {
		return decision{Action: "none", Reason: "not-failover-worthy", Classification: class}
	}
	chain := findChain(input.Config, input.Current)
	if chain == nil {
		return decision{Action: "none", Reason: "not-in-chain", Classification: class}
	}
	attempted := append([]string{}, input.Attempted...)
	seen := map[string]bool{}
	for _, key := range attempted {
		seen[key] = true
	}
	if !seen[input.Current] {
		attempted = append(attempted, input.Current)
		seen[input.Current] = true
	}
	blocked := map[string]bool{}
	for _, key := range input.Blocked {
		blocked[key] = true
	}
	for _, key := range chain.Models {
		if !seen[key] && !blocked[key] {
			return decision{Action: "failover", Next: key, Reason: class, Attempted: attempted}
		}
	}
	return decision{Action: "none", Reason: "no-unused-member", Classification: class}
}

func splitModelKey(key string) (string, string, bool) {
	slash := stringsIndex(key)
	if slash <= 0 || slash >= len(key)-1 {
		return "", "", false
	}
	return key[:slash], key[slash+1:], true
}

func validKey(key string) bool {
	_, _, ok := splitModelKey(key)
	return ok
}

func stringsIndex(key string) int {
	for i := 0; i < len(key); i++ {
		if key[i] == '/' {
			return i
		}
	}
	return -1
}

func findChain(config fallbackConfig, current string) *fallbackChain {
	for i := range config.Chains {
		for _, model := range config.Chains[i].Models {
			if model == current {
				return &config.Chains[i]
			}
		}
	}
	return nil
}
