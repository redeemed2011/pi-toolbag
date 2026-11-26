package ctx

import "sort"

type Live struct {
	ByID         map[string]Record
	Live         map[string]bool
	Constraints  []Record
	Questions    []Record
	Destinations []Record
	Blocked      map[string]bool
	AskOperator  map[string]bool
	LiveConflict []string
}

func FoldLive(records []Record) Live {
	sorted := append([]Record(nil), records...)
	sort.Slice(sorted, func(i, j int) bool {
		if sorted[i].TS != sorted[j].TS {
			return sorted[i].TS < sorted[j].TS
		}
		if sorted[i].Session != sorted[j].Session {
			return sorted[i].Session < sorted[j].Session
		}
		return sorted[i].ID < sorted[j].ID
	})
	byID := map[string]Record{}
	for _, rec := range sorted {
		if _, ok := byID[rec.ID]; !ok {
			byID[rec.ID] = rec
		}
	}
	superseded := map[string]bool{}
	children := map[string][]string{}
	for _, rec := range byID {
		for _, parent := range rec.Supersedes {
			superseded[parent] = true
			children[parent] = append(children[parent], rec.ID)
		}
	}
	live := map[string]bool{}
	for id := range byID {
		if !superseded[id] {
			live[id] = true
		}
	}
	conflicts := []string{}
	for parent, kids := range children {
		n := 0
		for _, id := range kids {
			if live[id] {
				n++
			}
		}
		if n > 1 {
			conflicts = append(conflicts, parent)
		}
	}
	sort.Strings(conflicts)
	blocked := map[string]bool{}
	ask := map[string]bool{}
	for _, rec := range byID {
		if !live[rec.ID] {
			continue
		}
		for _, id := range rec.Blocks {
			blocked[id] = true
		}
		if rec.Type == "decision" && rec.Headline == "Ask the operator" {
			for _, id := range rec.Asks {
				ask[id] = true
			}
		}
	}
	ofType := func(kind string) []Record {
		out := []Record{}
		for id := range live {
			rec := byID[id]
			if rec.Type == kind {
				out = append(out, rec)
			}
		}
		return out
	}
	destinations := ofType("destination")
	sort.Slice(destinations, func(i, j int) bool {
		if destinations[i].TS != destinations[j].TS {
			return destinations[i].TS < destinations[j].TS
		}
		return destinations[i].ID < destinations[j].ID
	})
	return Live{
		ByID:         byID,
		Live:         live,
		Constraints:  ofType("constraint"),
		Questions:    ofType("question"),
		Destinations: destinations,
		Blocked:      blocked,
		AskOperator:  ask,
		LiveConflict: conflicts,
	}
}

func Frontier(live Live, claimed string) []Record {
	out := []Record{}
	for _, q := range live.Questions {
		if q.ID == claimed || live.AskOperator[q.ID] || live.Blocked[q.ID] {
			continue
		}
		out = append(out, q)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].TS != out[j].TS {
			return out[i].TS < out[j].TS
		}
		return out[i].ID < out[j].ID
	})
	return out
}

func FollowClaim(live Live, claimed string) string {
	if claimed == "" || live.Live[claimed] {
		return claimed
	}
	children := map[string][]string{}
	for _, rec := range live.ByID {
		for _, parent := range rec.Supersedes {
			children[parent] = append(children[parent], rec.ID)
		}
	}
	seen := map[string]bool{claimed: true}
	reached := []string{}
	wave := []string{claimed}
	for len(wave) > 0 {
		next := []string{}
		for _, id := range wave {
			for _, kid := range children[id] {
				if seen[kid] {
					continue
				}
				seen[kid] = true
				if live.Live[kid] {
					reached = append(reached, kid)
				} else {
					next = append(next, kid)
				}
			}
		}
		wave = next
	}
	open := []string{}
	for _, id := range reached {
		if live.ByID[id].Type == "question" {
			open = append(open, id)
		}
	}
	if len(reached) == 1 && len(open) == 1 {
		return open[0]
	}
	return ""
}
