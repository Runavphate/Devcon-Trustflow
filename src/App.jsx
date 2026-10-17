import { useState, useEffect, useCallback, useMemo } from "react";
import "./index.css";
import { ethers } from "ethers";
import { CONTRACT_ADDRESS, ABI } from "./contract";

// ─── CONSTANTS ────────────────────────────────────────────────────────
const SEPOLIA_CHAIN_ID = 11155111n;
const ETHERSCAN = `https://sepolia.etherscan.io/address/${CONTRACT_ADDRESS}`;

// ─── HELPERS ──────────────────────────────────────────────────────────
function pct(raised, goal) {
  if (!goal) return 0;
  return Math.min((raised / goal) * 100, 100);
}

function shortAddr(addr) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function timeLeft(deadlineTs) {
  if (!deadlineTs) return null;
  const now = Math.floor(Date.now() / 1000);
  const diff = Number(deadlineTs) - now;
  if (diff <= 0) return "Ended";
  const d = Math.floor(diff / 86400);
  const h = Math.floor((diff % 86400) / 3600);
  if (d > 0) return `${d}d ${h}h left`;
  const m = Math.floor((diff % 3600) / 60);
  return `${h}h ${m}m left`;
}

function fmtEth(n) {
  return Number(n).toFixed(4).replace(/\.?0+$/, "");
}

// ─── METAMASK HELPERS ────────────────────────────────────────────────
function getMetaMaskProvider() {
  if (typeof window === "undefined" || !window.ethereum) return null;
  if (window.ethereum.providers && Array.isArray(window.ethereum.providers)) {
    const metaMask = window.ethereum.providers.find(
      (p) => p.isMetaMask && !p.isBraveWallet
    );
    if (metaMask) return metaMask;
    const anyMetaMask = window.ethereum.providers.find((p) => p.isMetaMask);
    if (anyMetaMask) return anyMetaMask;
    return window.ethereum.providers[0];
  }
  return window.ethereum;
}

async function switchToSepolia(provider) {
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0xaa36a7" }],
    });
    return true;
  } catch (switchError) {
    if (switchError?.code === 4902) {
      try {
        await provider.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: "0xaa36a7",
              chainName: "Sepolia Test Network",
              nativeCurrency: { name: "Sepolia ETH", symbol: "ETH", decimals: 18 },
              rpcUrls: ["https://rpc.sepolia.org"],
              blockExplorerUrls: ["https://sepolia.etherscan.io"],
            },
          ],
        });
        return true;
      } catch (addError) {
        console.error("Failed to add Sepolia network:", addError);
      }
    }
    return false;
  }
}

// ─── SKELETON ─────────────────────────────────────────────────────────
function SkeletonCard() {
  return (
    <div className="skeleton-card">
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <div className="skeleton" style={{ height: 48, width: 48, borderRadius: 14 }} />
        <div className="skeleton" style={{ height: 24, width: 64, borderRadius: 99 }} />
      </div>
      <div className="skeleton" style={{ height: 11, width: "35%", marginTop: 18 }} />
      <div className="skeleton" style={{ height: 22, width: "75%", marginTop: 6 }} />
      <div className="skeleton" style={{ height: 13, width: "100%", marginTop: 12 }} />
      <div className="skeleton" style={{ height: 13, width: "85%" }} />
      <div className="skeleton" style={{ height: 5, marginTop: 22, borderRadius: 99 }} />
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10 }}>
        <div className="skeleton" style={{ height: 13, width: "38%" }} />
        <div className="skeleton" style={{ height: 13, width: "22%" }} />
      </div>
      <div className="skeleton" style={{ height: 42, marginTop: 22, borderRadius: 12 }} />
    </div>
  );
}

// ─── TOAST ────────────────────────────────────────────────────────────
function Toast({ message, type }) {
  if (!message) return null;
  const icon = type === "success" ? "✓" : type === "error" ? "✕" : "↻";
  return (
    <div className={`status-bar ${type}`} role="status">
      <span className="toast-icon">{icon}</span>
      {message}
    </div>
  );
}

// ─── TX OVERLAY ───────────────────────────────────────────────────────
// txState: null | { stage: 0|1|2|3, label: string, hash?: string, action: string }
// stage 0 = waiting for MetaMask, 1 = tx sent, 2 = confirmed, 3 = failed
function TxOverlay({ txState, onClose }) {
  if (!txState) return null;

  const steps = [
    { id: 0, label: "Awaiting signature", desc: "Confirm the transaction in MetaMask" },
    { id: 1, label: "Broadcasting", desc: "Transaction sent to the network" },
    { id: 2, label: "Confirming on-chain", desc: "Waiting for block confirmation" },
    { id: 3, label: "Done!", desc: "Transaction confirmed ✓" },
  ];

  const isFailed = txState.stage === "failed";
  const isDone = txState.stage === 3;
  const curStep = isFailed ? -1 : txState.stage;

  return (
    <div className="tx-overlay" onClick={isDone || isFailed ? onClose : undefined}>
      <div className="tx-modal" onClick={(e) => e.stopPropagation()}>

        {/* Top badge */}
        <div className="tx-badge">
          {isFailed ? "❌" : isDone ? "✅" : "⛓️"}
        </div>

        <h3 className="tx-title">
          {isFailed ? "Transaction Failed" : isDone ? "Transaction Confirmed!" : txState.action}
        </h3>

        {txState.hash && (
          <a
            className="tx-hash"
            href={`https://sepolia.etherscan.io/tx/${txState.hash}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {txState.hash.slice(0, 10)}…{txState.hash.slice(-8)}
            <span className="tx-hash-arrow">↗</span>
          </a>
        )}

        {/* Step list */}
        {!isFailed && (
          <div className="tx-steps">
            {steps.map((s) => {
              const done = curStep > s.id;
              const active = curStep === s.id;
              const pending = curStep < s.id;
              return (
                <div
                  key={s.id}
                  className={`tx-step ${done ? "done" : active ? "active" : "pending"}`}
                >
                  <div className="tx-step-icon">
                    {done ? <span className="tx-check">✓</span> :
                      active ? <span className="tx-spinner" /> :
                        <span className="tx-dot" />}
                  </div>
                  <div className="tx-step-body">
                    <div className="tx-step-label">{s.label}</div>
                    {active && <div className="tx-step-desc">{s.desc}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {isFailed && (
          <p className="tx-error-msg">{txState.label}</p>
        )}

        {(isDone || isFailed) && (
          <button className="btn-primary tx-close-btn" onClick={onClose}>
            {isDone ? "🎉 Done" : "Close"}
          </button>
        )}

        {!isDone && !isFailed && (
          <p className="tx-waiting-hint">Do not close this window…</p>
        )}
      </div>
    </div>
  );
}

// ─── STAT CHIP ────────────────────────────────────────────────────────
function StatChip({ icon, label, value, highlight }) {
  return (
    <div className={`stat-chip ${highlight ? "stat-chip--green" : ""}`}>
      <div className="stat-icon">{icon}</div>
      <div>
        <div className="stat-value">{value}</div>
        <div className="stat-label">{label}</div>
      </div>
    </div>
  );
}

// ─── HOW IT WORKS ────────────────────────────────────────────────────
function HowItWorks() {
  const steps = [
    {
      bubble: "lime",
      icon: "🔑",
      num: "1",
      title: "Connect your wallet",
      desc: "Link MetaMask or any Web3 wallet to TrustFlow in one click. No sign-up, no email — just your Ethereum address.",
    },
    {
      bubble: "violet",
      icon: "🚀",
      num: "2",
      title: "Create or back a campaign",
      desc: "Launch a campaign with a funding goal and deadline, or contribute ETH to projects you believe in.",
    },
    {
      bubble: "cyan",
      icon: "✅",
      num: "3",
      title: "Milestone-gated release",
      desc: "Funds unlock only when the creator approves milestones on-chain. Miss the goal? Claim a full refund.",
    },
  ];
  return (
    <div className="how-it-works">
      <div className="how-heading">
        <h2>How it works</h2>
        <div className="how-heading-line" />
      </div>
      <div className="timeline">
        {steps.map((s) => (
          <div key={s.num} className="timeline-step">
            <div className={`step-bubble ${s.bubble}`}>
              {s.icon}
              <span className="step-number">{s.num}</span>
            </div>
            <div className="step-title">{s.title}</div>
            <div className="step-desc">{s.desc}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── FEATURES STRIP ───────────────────────────────────────────────────
function FeaturesStrip() {
  const features = [
    {
      icon: "🔗",
      iconClass: "green",
      title: "On-Chain Transparency",
      desc: "Every campaign, contribution, and fund release is permanently recorded on Ethereum Sepolia — fully auditable.",
    },
    {
      icon: "🛡️",
      iconClass: "purple",
      title: "Milestone-Gated Releases",
      desc: "Funds are only released after the creator approves milestones, protecting contributors from misuse.",
    },
    {
      icon: "⚡",
      iconClass: "cyan",
      title: "Instant Refund Claims",
      desc: "If a campaign deadline passes without reaching its goal, contributors can claim full refunds trustlessly.",
    },
  ];

  return (
    <div className="features-strip">
      {features.map((f) => (
        <div key={f.title} className="feature-card">
          <div className={`feature-icon ${f.iconClass}`}>{f.icon}</div>
          <div className="feature-title">{f.title}</div>
          <div className="feature-desc">{f.desc}</div>
        </div>
      ))}
    </div>
  );
}

// ─── PROJECT DETAIL DRAWER ────────────────────────────────────────────
function DetailDrawer({ project, account, onClose, onContribute, onRelease }) {
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const percentage = pct(project.raised, project.goal);
  const isCreator =
    account &&
    project.creator &&
    account.toLowerCase() === project.creator.toLowerCase();
  const deadline = timeLeft(project.deadline);

  async function handleContribute() {
    const val = Number(amount);
    if (!amount || !Number.isFinite(val) || val <= 0) return;
    setBusy(true);
    await onContribute(project.id, amount);
    setBusy(false);
    setAmount("");
  }

  return (
    <div
      className="drawer-backdrop"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <aside className="drawer">
        {/* Header */}
        <div className="drawer-header">
          <div className="drawer-title-row">
            <div className="project-icon-lg">✳</div>
            <div>
              <p className="card-eyebrow" style={{ marginBottom: 5 }}>
                Campaign #{project.id}
              </p>
              <h3 className="drawer-title">{project.title}</h3>
            </div>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="drawer-body">
          {/* Description */}
          <div className="drawer-section">
            <h4 className="drawer-section-title">About this project</h4>
            <p className="drawer-desc">{project.description}</p>
          </div>

          {/* Stats grid */}
          <div className="drawer-stats">
            <div className="dstat">
              <span className="dstat-label">Raised</span>
              <span className="dstat-value green">{fmtEth(project.raised)} ETH</span>
            </div>
            <div className="dstat">
              <span className="dstat-label">Goal</span>
              <span className="dstat-value">{fmtEth(project.goal)} ETH</span>
            </div>
            <div className="dstat">
              <span className="dstat-label">Progress</span>
              <span className="dstat-value">{percentage.toFixed(1)}%</span>
            </div>
            <div className="dstat">
              <span className="dstat-label">Deadline</span>
              <span className={`dstat-value ${deadline === "Ended" ? "red" : ""}`}>
                {deadline || "—"}
              </span>
            </div>
            <div className="dstat">
              <span className="dstat-label">Status</span>
              <span className={`dstat-value ${project.released ? "green" : "muted"}`}>
                {project.released ? "Funded ✓" : "Active"}
              </span>
            </div>
            <div className="dstat">
              <span className="dstat-label">Creator</span>
              <a
                className="dstat-value dstat-link"
                href={`https://sepolia.etherscan.io/address/${project.creator}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {project.creator ? shortAddr(project.creator) : "—"}
              </a>
            </div>
          </div>

          {/* Progress bar */}
          <div className="progress-wrap" style={{ marginTop: 0 }}>
            <div className="progress">
              <div
                className="progress-fill"
                style={{ width: `${Math.min(percentage, 100)}%` }}
              />
            </div>
            <div className="funding" style={{ marginTop: 12 }}>
              <strong>{fmtEth(project.raised)} ETH raised</strong>
              <span>
                {(project.goal - project.raised).toFixed(4).replace(/\.?0+$/, "")}{" "}
                ETH to go
              </span>
            </div>
          </div>

          {/* Contribute */}
          {!project.released && (
            <div className="drawer-section">
              <h4 className="drawer-section-title">Contribute to this campaign</h4>
              <div className="contribute-row">
                <div className="contribute-input-wrap">
                  <input
                    className="contribute-input"
                    type="number"
                    step="0.001"
                    min="0.001"
                    placeholder="0.05"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                  <span className="contribute-unit">ETH</span>
                </div>
                <button
                  className="btn-primary"
                  onClick={handleContribute}
                  disabled={busy || !account || !amount}
                  style={{ flexShrink: 0 }}
                >
                  {busy ? "Sending…" : "Fund it"}
                </button>
              </div>
              {!account && (
                <p className="form-hint" style={{ marginTop: 10 }}>
                  Connect your wallet to contribute.
                </p>
              )}
              {isCreator && (
                <button
                  className="btn-danger"
                  style={{ marginTop: 12 }}
                  onClick={() => onRelease(project.id)}
                >
                  🔓 Release funds to creator
                </button>
              )}
            </div>
          )}

          {project.released && (
            <div className="released-badge" style={{ marginTop: 4 }}>
              ✓ Funds have been released to the creator
            </div>
          )}

          {/* Etherscan */}
          <a
            className="etherscan-link"
            href={`${ETHERSCAN}#readContract`}
            target="_blank"
            rel="noopener noreferrer"
          >
            🔗 View on Etherscan ↗
          </a>
        </div>
      </aside>
    </div>
  );
}

// ─── CREATE CAMPAIGN MODAL ────────────────────────────────────────────
function CreateModal({ onClose, onCreated, account, toast }) {
  const [form, setForm] = useState({
    title: "",
    description: "",
    goal: "",
    days: "",
  });
  const [busy, setBusy] = useState(false);

  function set(field, val) {
    setForm((f) => ({ ...f, [field]: val }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.title || !form.description || !form.goal || !form.days) {
      toast("Please fill in all fields.", "error");
      return;
    }
    const goal = Number(form.goal);
    const days = Number(form.days);
    if (!Number.isFinite(goal) || goal <= 0) {
      toast("Invalid goal amount.", "error");
      return;
    }
    if (!Number.isFinite(days) || days < 1 || days > 365) {
      toast("Duration must be 1–365 days.", "error");
      return;
    }
    setBusy(true);
    try {
      const ethProvider = getMetaMaskProvider();
      if (!ethProvider) {
        toast("MetaMask is not detected.", "error");
        setBusy(false);
        return;
      }
      const provider = new ethers.BrowserProvider(ethProvider);
      const network = await provider.getNetwork();
      if (network.chainId !== SEPOLIA_CHAIN_ID) {
        const switched = await switchToSepolia(ethProvider);
        if (!switched) {
          toast("Switch MetaMask to Sepolia first.", "error");
          setBusy(false);
          return;
        }
      }
      const signer = await provider.getSigner();
      const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, signer);
      const tx = await contract.createCampaign(
        form.title,
        form.description,
        ethers.parseEther(form.goal),
        days
      );
      toast("Transaction sent — waiting for confirmation…", "loading");
      await tx.wait();
      toast("Campaign created on Sepolia! 🎉", "success");
      onCreated();
      onClose();
    } catch (err) {
      console.error(err);
      toast("Transaction failed or was rejected.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="modal">
        <div className="modal-header">
          <div>
            <h3>🚀 Launch a campaign</h3>
            <p style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 6 }}>
              Your campaign will live on the Sepolia blockchain.
            </p>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="camp-title">Campaign title</label>
            <input
              id="camp-title"
              placeholder="e.g. Community Solar Project"
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
              maxLength={80}
              autoFocus
            />
          </div>
          <div className="form-group">
            <label htmlFor="camp-desc">Description</label>
            <textarea
              id="camp-desc"
              placeholder="Describe your project and how funds will be used…"
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              maxLength={500}
            />
            <p className="form-hint">{form.description.length}/500</p>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="camp-goal">Funding goal (ETH)</label>
              <input
                id="camp-goal"
                type="number"
                step="0.001"
                min="0.001"
                placeholder="1.5"
                value={form.goal}
                onChange={(e) => set("goal", e.target.value)}
              />
              <p className="form-hint">Min 0.001 ETH</p>
            </div>
            <div className="form-group">
              <label htmlFor="camp-days">Duration (days)</label>
              <input
                id="camp-days"
                type="number"
                min="1"
                max="365"
                placeholder="30"
                value={form.days}
                onChange={(e) => set("days", e.target.value)}
              />
              <p className="form-hint">1–365 days</p>
            </div>
          </div>
          <div className="form-footer">
            <button
              type="button"
              className="btn-ghost"
              onClick={onClose}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={busy || !account}
            >
              {busy
                ? "Confirming…"
                : account
                  ? "🚀 Launch campaign"
                  : "Connect wallet first"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── PROJECT CARD ─────────────────────────────────────────────────────
function ProjectCard({ project, account, onContribute, onRelease, onOpen }) {
  const percentage = pct(project.raised, project.goal);
  const isCreator =
    account &&
    project.creator &&
    account.toLowerCase() === project.creator.toLowerCase();
  const deadline = timeLeft(project.deadline);

  return (
    <article className="project-card" onClick={() => onOpen(project)}>
      <div className="card-header">
        <div className="project-icon">✳</div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {isCreator && <span className="tag tag-creator">You</span>}
          {project.released ? (
            <span className="tag tag-funded">Funded</span>
          ) : (
            <span className="tag tag-active">Live</span>
          )}
        </div>
      </div>

      <p className="card-eyebrow" style={{ marginTop: 16 }}>
        Campaign #{project.id}
      </p>
      <h3>{project.title}</h3>
      <p className="card-desc">{project.description}</p>

      {/* Progress */}
      <div className="progress-wrap">
        <div className="progress">
          <div
            className="progress-fill"
            style={{ width: `${Math.min(percentage, 100)}%` }}
          />
        </div>
        <div className="funding">
          <strong>{fmtEth(project.raised)} ETH</strong>
          <span>{percentage.toFixed(1)}%</span>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span className="funding-sub">of {fmtEth(project.goal)} ETH goal</span>
          {deadline && (
            <span className={`deadline-chip ${deadline === "Ended" ? "ended" : ""}`}>
              ⏱ {deadline}
            </span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="card-actions" onClick={(e) => e.stopPropagation()}>
        {project.released ? (
          <div className="released-badge">✓ Funds released</div>
        ) : (
          <>
            <button
              className="btn-secondary"
              onClick={() => onContribute(project.id, null)}
            >
              💸 Contribute ETH
            </button>
            {isCreator && (
              <button
                className="btn-danger btn-sm"
                onClick={() => onRelease(project.id)}
              >
                🔓 Release funds
              </button>
            )}
          </>
        )}
      </div>

      <p className="card-hint">Click for full details →</p>
    </article>
  );
}

// ─── APP ──────────────────────────────────────────────────────────────
export default function App() {
  const [account, setAccount] = useState("");
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [selected, setSelected] = useState(null);
  const [filter, setFilter] = useState("all");
  const [sortBy, setSortBy] = useState("newest");
  const [toastMsg, setToastMsg] = useState("");
  const [toastType, setToastType] = useState("loading");
  const [toastTimer, setToastTimer] = useState(null);
  // tx overlay state: null means hidden
  const [txState, setTxState] = useState(null);

  // ── toast ──────────────────────────────────────────────────────────
  function toast(msg, type = "loading") {
    if (toastTimer) clearTimeout(toastTimer);
    setToastMsg(msg);
    setToastType(type);
    if (type !== "loading") {
      const t = setTimeout(() => setToastMsg(""), 4500);
      setToastTimer(t);
    }
  }

  // ── loadProjects ───────────────────────────────────────────────────
  const loadProjects = useCallback(async () => {
    setLoading(true);
    try {
      let provider;
      const ethProvider = getMetaMaskProvider();
      if (ethProvider) {
        try {
          const bp = new ethers.BrowserProvider(ethProvider);
          const network = await bp.getNetwork();
          if (network.chainId === SEPOLIA_CHAIN_ID) {
            provider = bp;
          }
        } catch {
          // ignore, will use public fallback
        }
      }
      if (!provider) {
        provider = new ethers.JsonRpcProvider("https://rpc.sepolia.org");
      }
      const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, provider);
      const count = Number(await contract.campaignCount());
      const items = [];
      for (let id = 1; id <= count; id++) {
        const c = await contract.campaigns(id);
        items.push({
          id,
          creator: c.creator,
          title: c.title,
          description: c.description,
          goal: Number(ethers.formatEther(c.goal)),
          raised: Number(ethers.formatEther(c.raised)),
          deadline: c.deadline,
          released: c.released,
          milestone: c.released ? "Funds released" : "Final milestone",
        });
      }
      setProjects(items);
    } catch (err) {
      console.error("Load campaigns error:", err);
      toast("Could not load campaigns. Please verify network.", "error");
    } finally {
      setLoading(false);
    }
  }, []);

  // ── connectWallet ──────────────────────────────────────────────────
  async function connectWallet() {
    const provider = getMetaMaskProvider();
    if (!provider) {
      toast("MetaMask not found. Please install MetaMask.", "error");
      window.open("https://metamask.io/download/", "_blank");
      return;
    }

    try {
      let accounts = [];

      // Explicitly trigger MetaMask popup for account selection
      try {
        const permissions = await provider.request({
          method: "wallet_requestPermissions",
          params: [{ eth_accounts: {} }],
        });
        const ethPerm = permissions?.find(
          (p) => p.parentCapability === "eth_accounts"
        );
        if (ethPerm?.caveats?.[0]?.value) {
          accounts = ethPerm.caveats[0].value;
        }
      } catch (permErr) {
        if (permErr?.code === 4001) {
          toast("Connection request cancelled in MetaMask.", "error");
          return;
        }
      }

      if (!accounts || accounts.length === 0) {
        accounts = await provider.request({
          method: "eth_requestAccounts",
        });
      }

      if (accounts && accounts[0]) {
        const addr = accounts[0];
        setAccount(addr);
        localStorage.setItem("trustflow_connected", "true");
        toast(`Connected: ${shortAddr(addr)}`, "success");

        // Verify Sepolia network
        try {
          const chainId = await provider.request({ method: "eth_chainId" });
          if (BigInt(chainId) !== SEPOLIA_CHAIN_ID) {
            await switchToSepolia(provider);
          }
        } catch (chainErr) {
          console.warn("Chain switch error:", chainErr);
        }

        await loadProjects();
      }
    } catch (err) {
      console.error("MetaMask connect error:", err);
      if (err?.code === 4001) {
        toast("MetaMask connection request rejected.", "error");
      } else if (err?.code === -32002) {
        toast("MetaMask popup already pending! Click the fox icon in your browser toolbar.", "error");
      } else {
        toast(err?.message || "Failed to connect wallet.", "error");
      }
    }
  }

  // ── disconnectWallet ───────────────────────────────────────────────
  function disconnectWallet() {
    setAccount("");
    localStorage.removeItem("trustflow_connected");
    toast("Wallet disconnected.", "success");
  }

  // ── contribute ─────────────────────────────────────────────────────
  async function contribute(id, amount) {
    const ethProvider = getMetaMaskProvider();
    if (!ethProvider) {
      toast("Install MetaMask first.", "error");
      return;
    }
    try {
      const provider = new ethers.BrowserProvider(ethProvider);
      const network = await provider.getNetwork();
      if (network.chainId !== SEPOLIA_CHAIN_ID) {
        const switched = await switchToSepolia(ethProvider);
        if (!switched) {
          toast("Switch to Sepolia first.", "error");
          return;
        }
      }
      const signer = await provider.getSigner();
      const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, signer);
      const value = amount ?? prompt("How much test ETH to contribute?");
      if (!value || !Number.isFinite(Number(value)) || Number(value) <= 0)
        return;

      // stage 0: waiting for MetaMask
      setTxState({ stage: 0, action: "Contributing ETH", label: "Open MetaMask to sign" });

      const tx = await contract.contribute(id, {
        value: ethers.parseEther(String(value)),
      });

      // stage 1 → 2: tx sent, waiting for block
      setTxState({ stage: 1, action: "Contributing ETH", label: "Transaction sent", hash: tx.hash });
      await new Promise((r) => setTimeout(r, 400));
      setTxState({ stage: 2, action: "Contributing ETH", label: "Waiting for block…", hash: tx.hash });

      await tx.wait();

      // stage 3: done
      setTxState({ stage: 3, action: "Contributing ETH", label: "Confirmed!", hash: tx.hash });
      toast("Contribution confirmed! 🎉", "success");
      await loadProjects();
    } catch (err) {
      console.error(err);
      setTxState({ stage: "failed", action: "Contribute", label: err?.reason || "Transaction rejected or failed." });
    }
  }

  // ── releaseFunds ───────────────────────────────────────────────────
  async function releaseFunds(id) {
    const ethProvider = getMetaMaskProvider();
    if (!ethProvider) {
      toast("Install MetaMask first.", "error");
      return;
    }
    try {
      const provider = new ethers.BrowserProvider(ethProvider);
      const network = await provider.getNetwork();
      if (network.chainId !== SEPOLIA_CHAIN_ID) {
        const switched = await switchToSepolia(ethProvider);
        if (!switched) {
          toast("Switch to Sepolia first.", "error");
          return;
        }
      }
      const signer = await provider.getSigner();
      const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, signer);

      // stage 0: waiting for MetaMask
      setTxState({ stage: 0, action: "Releasing Funds", label: "Open MetaMask to sign" });

      const tx = await contract.approveMilestoneAndRelease(id);

      setTxState({ stage: 1, action: "Releasing Funds", label: "Transaction sent", hash: tx.hash });
      await new Promise((r) => setTimeout(r, 400));
      setTxState({ stage: 2, action: "Releasing Funds", label: "Waiting for block…", hash: tx.hash });

      await tx.wait();

      setTxState({ stage: 3, action: "Releasing Funds", label: "Funds released!", hash: tx.hash });
      toast("Funds released successfully! ✓", "success");
      await loadProjects();
    } catch (err) {
      console.error(err);
      setTxState({ stage: "failed", action: "Release Funds", label: err?.reason || "Release failed. Check deadline & goal conditions." });
    }
  }

  // ── wallet listeners ───────────────────────────────────────────────
  useEffect(() => {
    const provider = getMetaMaskProvider();
    if (provider) {
      const handleAccountsChanged = (accs) => {
        if (accs && accs.length > 0) {
          setAccount(accs[0]);
          localStorage.setItem("trustflow_connected", "true");
        } else {
          setAccount("");
          localStorage.removeItem("trustflow_connected");
        }
      };

      const handleChainChanged = () => {
        loadProjects();
      };

      provider.on("accountsChanged", handleAccountsChanged);
      provider.on("chainChanged", handleChainChanged);

      // Auto-reconnect if previously connected in this session
      if (localStorage.getItem("trustflow_connected") === "true") {
        provider
          .request({ method: "eth_accounts" })
          .then((accs) => {
            if (accs && accs.length > 0) {
              setAccount(accs[0]);
            }
          })
          .catch(console.error);
      }

      return () => {
        provider.removeListener?.("accountsChanged", handleAccountsChanged);
        provider.removeListener?.("chainChanged", handleChainChanged);
      };
    }
    loadProjects();
  }, [loadProjects]);

  // ── computed ───────────────────────────────────────────────────────
  const stats = useMemo(
    () => ({
      total: projects.length,
      active: projects.filter((p) => !p.released).length,
      funded: projects.filter((p) => p.released).length,
      raised: projects.reduce((s, p) => s + p.raised, 0),
    }),
    [projects]
  );

  const visible = useMemo(() => {
    let list = [...projects];
    if (filter === "active") list = list.filter((p) => !p.released);
    if (filter === "funded") list = list.filter((p) => p.released);
    if (sortBy === "pct")
      list.sort((a, b) => pct(b.raised, b.goal) - pct(a.raised, a.goal));
    if (sortBy === "raised") list.sort((a, b) => b.raised - a.raised);
    if (sortBy === "newest") list.sort((a, b) => b.id - a.id);
    return list;
  }, [projects, filter, sortBy]);

  // ── render ─────────────────────────────────────────────────────────
  return (
    <>
      <div className="app">

        {/* ── NAVBAR ────────────────────────────────────────────── */}
        <nav className="navbar">
          <div className="navbar-brand">
            <div className="navbar-logo">⚡</div>
            <h2>
              Trust<span>Flow</span>
            </h2>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div className="network-badge">
              <span className="network-dot" />
              Sepolia
            </div>
          </div>

          <div className="navbar-actions">
            {account && (
              <button
                className="btn-primary btn-sm"
                onClick={() => setShowModal(true)}
                id="add-project-btn"
              >
                + New Campaign
              </button>
            )}
            {account ? (
              <div className="wallet-connected-group">
                <div className="wallet-badge" title={account}>
                  <span className="wallet-dot" />
                  <span className="wallet-addr">{shortAddr(account)}</span>
                </div>
                <button
                  className="btn-disconnect btn-sm"
                  onClick={disconnectWallet}
                  id="disconnect-wallet-btn"
                  title="Disconnect wallet"
                >
                  Disconnect
                </button>
              </div>
            ) : (
              <button
                className="btn-primary btn-sm"
                onClick={connectWallet}
                id="connect-wallet-btn"
              >
                Connect Wallet
              </button>
            )}
          </div>
        </nav>

        {/* ── HERO ──────────────────────────────────────────────── */}
        <section className="hero">
          <div className="eyebrow">Crowdfunding, with accountability</div>
          <h1>
            Great projects.<br />
            <em>Transparent</em> funding.
          </h1>
          <p>
            Support ideas you believe in. Track milestones on‑chain.
            Every contribution is public, every release is verified
            by the Ethereum network.
          </p>
          <div className="hero-cta">
            <button
              className="btn-primary"
              onClick={account ? () => setShowModal(true) : connectWallet}
              id="hero-cta-btn"
            >
              {account ? "🚀 New Campaign" : "Get Started →"}
            </button>
            <div className="hero-stat">
              <strong>{stats.total}</strong> campaign{stats.total !== 1 ? "s" : ""}{" "}
              ·{" "}
              <strong>{fmtEth(stats.raised)}</strong> ETH raised
            </div>
          </div>
        </section>

        {/* ── HOW IT WORKS ──────────────────────────────────────────── */}
        <HowItWorks />

        {/* ── FEATURES STRIP ────────────────────────────────────── */}
        <FeaturesStrip />

        {/* ── STATS BAR ─────────────────────────────────────────── */}
        {!loading && projects.length > 0 && (
          <div className="stats-bar">
            <StatChip icon="📋" label="Total campaigns" value={stats.total} />
            <StatChip icon="🟢" label="Live campaigns" value={stats.active} />
            <StatChip icon="✅" label="Fully funded" value={stats.funded} />
            <StatChip
              icon="⚡"
              label="Total ETH raised"
              value={`${fmtEth(stats.raised)} ETH`}
              highlight
            />
            <a
              className="stat-chip stat-etherscan"
              href={ETHERSCAN}
              target="_blank"
              rel="noopener noreferrer"
            >
              <div className="stat-icon">🔗</div>
              <div>
                <div className="stat-value">Etherscan</div>
                <div className="stat-label">View contract ↗</div>
              </div>
            </a>
          </div>
        )}

        {/* ── CAMPAIGNS SECTION ─────────────────────────────────── */}
        <section>
          <div className="section-heading">
            <div>
              <h2>Explore campaigns</h2>
              <p>Community projects on Ethereum Sepolia</p>
            </div>
            <div className="controls">
              {/* Filter tabs */}
              <div className="filter-tabs" role="tablist">
                {["all", "active", "funded"].map((f) => (
                  <button
                    key={f}
                    role="tab"
                    aria-selected={filter === f}
                    className={`filter-tab ${filter === f ? "active" : ""}`}
                    onClick={() => setFilter(f)}
                  >
                    {f.charAt(0).toUpperCase() + f.slice(1)}
                    {f === "active" && stats.active > 0 && (
                      <span className="tab-count">{stats.active}</span>
                    )}
                    {f === "funded" && stats.funded > 0 && (
                      <span className="tab-count tab-count--green">
                        {stats.funded}
                      </span>
                    )}
                  </button>
                ))}
              </div>
              {/* Sort */}
              <select
                className="sort-select"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                aria-label="Sort campaigns"
              >
                <option value="newest">↕ Newest</option>
                <option value="pct">↕ % Funded</option>
                <option value="raised">↕ Most raised</option>
              </select>
            </div>
          </div>

          {loading ? (
            <div className="project-grid">
              {[1, 2, 3].map((n) => (
                <SkeletonCard key={n} />
              ))}
            </div>
          ) : visible.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">
                {filter === "funded" ? "✅" : "🌱"}
              </div>
              <h3>
                {filter === "all"
                  ? "No campaigns yet"
                  : `No ${filter} campaigns`}
              </h3>
              <p>
                {filter === "all"
                  ? "Be the first to launch a project on TrustFlow."
                  : `Switch to 'All' or create a new campaign.`}
              </p>
              {filter === "all" && (
                <button
                  className="btn-primary"
                  onClick={account ? () => setShowModal(true) : connectWallet}
                >
                  {account ? "🚀 New Campaign" : "Connect wallet to start"}
                </button>
              )}
            </div>
          ) : (
            <div className="project-grid">
              {visible.map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  account={account}
                  onContribute={contribute}
                  onRelease={releaseFunds}
                  onOpen={setSelected}
                />
              ))}
            </div>
          )}
        </section>

        {/* ── FOOTER ────────────────────────────────────────────── */}
        <footer>
          <p style={{ marginBottom: 8, fontWeight: 600, color: "var(--text-muted)" }}>
            TrustFlow · Transparent crowdfunding on Ethereum
          </p>
          <p>
            Contract on{" "}
            <a href={ETHERSCAN} target="_blank" rel="noopener noreferrer">
              Sepolia Etherscan ↗
            </a>{" "}
            · Built with ❤️ &amp; ethers.js
          </p>
        </footer>
      </div>

      {/* ── DETAIL DRAWER ─────────────────────────────────────────── */}
      {selected && (
        <DetailDrawer
          project={selected}
          account={account}
          onClose={() => setSelected(null)}
          onContribute={contribute}
          onRelease={releaseFunds}
        />
      )}

      {/* ── CREATE MODAL ──────────────────────────────────────────── */}
      {showModal && (
        <CreateModal
          onClose={() => setShowModal(false)}
          onCreated={loadProjects}
          account={account}
          toast={toast}
        />
      )}

      {/* ── TOAST ─────────────────────────────────────────────────── */}
      <Toast message={toastMsg} type={toastType} />
    </>
  );
}
