import { useMemo } from 'react';
import type { Address } from 'viem';
import { explorerAddress, type Deployment } from '../lib/deployment';
import type { AsyncState } from '../lib/useAsync';
import { useAsync } from '../lib/useAsync';
import { fmtAmount } from '../lib/format';
import type { ChainVerification } from '../App';

interface Props {
  deployment: Deployment | null;
  verification: AsyncState<ChainVerification>;
}

export interface TokenMeta {
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: bigint;
}

export interface ProjectMeta {
  token: Address;
  version: bigint;
  siteLabel: string;
}

export function useTokenMeta(deployment: Deployment | null): AsyncState<TokenMeta> {
  const fn = useMemo(() => {
    if (!deployment) return null;
    return async (): Promise<TokenMeta> => {
      const { publicClient, token } = deployment;
      const base = { address: token.address as Address, abi: token.abi } as const;
      const [name, symbol, decimals, totalSupply] = await Promise.all([
        publicClient.readContract({ ...base, functionName: 'name' }) as Promise<string>,
        publicClient.readContract({ ...base, functionName: 'symbol' }) as Promise<string>,
        publicClient.readContract({ ...base, functionName: 'decimals' }) as Promise<number>,
        publicClient.readContract({ ...base, functionName: 'totalSupply' }) as Promise<bigint>,
      ]);
      return { name, symbol, decimals: Number(decimals), totalSupply };
    };
  }, [deployment]);
  return useAsync(fn, [deployment]);
}

function useProjectMeta(deployment: Deployment | null): AsyncState<ProjectMeta> {
  const fn = useMemo(() => {
    if (!deployment) return null;
    return async (): Promise<ProjectMeta> => {
      const { publicClient, project } = deployment;
      const base = { address: project.address as Address, abi: project.abi } as const;
      const [token, version, siteLabel] = await Promise.all([
        publicClient.readContract({ ...base, functionName: 'token' }) as Promise<Address>,
        publicClient.readContract({ ...base, functionName: 'version' }) as Promise<bigint>,
        publicClient.readContract({ ...base, functionName: 'siteLabel' }) as Promise<string>,
      ]);
      return { token, version, siteLabel };
    };
  }, [deployment]);
  return useAsync(fn, [deployment]);
}

export function DeploymentPanel({ deployment, verification }: Props) {
  const token = useTokenMeta(deployment);
  const project = useProjectMeta(deployment);

  if (!deployment) {
    return (
      <section className="card" aria-busy="true" aria-labelledby="deployment-h">
        <h2 id="deployment-h">Live Deployment</h2>
        <p className="muted">Loading deployment configuration…</p>
      </section>
    );
  }

  const net = deployment.network;
  const tokenMatches = project.data ? project.data.token.toLowerCase() === deployment.token.address.toLowerCase() : null;

  return (
    <section className="card" aria-labelledby="deployment-h">
      <div className="card-head">
        <h2 id="deployment-h">Live Deployment</h2>
        <span className="muted small">
          {net ? `${net.name} · chain ${deployment.manifest.chainId}` : `chain ${deployment.manifest.chainId}`}
          {net?.testnet ? ' · testnet' : ''}
        </span>
      </div>

      <div className="status-row" aria-live="polite">
        <StatusPill ok={Object.values(deployment.contracts).every((c) => c.abiVerified)} label="ABI hashes match handoff" />
        <StatusPill
          ok={verification.data ? verification.data.tokenCode && verification.data.projectCode : null}
          label={verification.error ? `RPC check failed: ${verification.error}` : 'Contract code present on configured RPC'}
        />
        <StatusPill ok={tokenMatches} label="ComputeProject.token() equals SeatCompute" />
      </div>

      <div className="grid-2">
        <div className="contract-block">
          <h3>
            SeatCompute <span className="muted">(ERC-20)</span>
          </h3>
          <AddressLine address={deployment.token.address} explorer={explorerAddress(net, deployment.token.address)} />
          <dl className="kv">
            <dt>Name / symbol</dt>
            <dd>{token.data ? `${token.data.name} / ${token.data.symbol}` : token.error ? <span className="inline-error">{token.error}</span> : 'Loading…'}</dd>
            <dt>Decimals</dt>
            <dd>{token.data ? token.data.decimals : '…'}</dd>
            <dt>Total supply</dt>
            <dd className="num" translate="no">
              {token.data ? `${fmtAmount(token.data.totalSupply, token.data.decimals)} ${token.data.symbol}` : '…'}
              {token.data && <span className="muted small"> ({token.data.totalSupply.toString()} minor units)</span>}
            </dd>
          </dl>
        </div>
        <div className="contract-block">
          <h3>
            ComputeProject <span className="muted">(companion)</span>
          </h3>
          <AddressLine address={deployment.project.address} explorer={explorerAddress(net, deployment.project.address)} />
          <dl className="kv">
            <dt>token()</dt>
            <dd className="mono" translate="no">
              {project.data ? project.data.token : project.error ? <span className="inline-error">{project.error}</span> : 'Loading…'}
            </dd>
            <dt>version()</dt>
            <dd>{project.data ? project.data.version.toString() : '…'}</dd>
            <dt>siteLabel()</dt>
            <dd translate="no">{project.data ? project.data.siteLabel : '…'}</dd>
          </dl>
        </div>
      </div>

      <details className="details">
        <summary>Handoff identifiers and RPC configuration</summary>
        <dl className="kv">
          <dt>Launch id</dt>
          <dd className="mono" translate="no">
            {deployment.manifest.launchId}
          </dd>
          <dt>Source commit</dt>
          <dd className="mono" translate="no">
            {deployment.manifest.sourceCommit}
          </dd>
          <dt>Attestation hash</dt>
          <dd className="mono break" translate="no">
            {deployment.manifest.attestationHash}
          </dd>
          {Object.values(deployment.contracts).map((c) => (
            <ContractHashRow key={c.name} name={c.name} hash={c.abiHash} path={c.abiPath} />
          ))}
          <dt>Public RPC URLs</dt>
          <dd>
            <ul className="plain-list">
              {(net?.rpcUrls ?? []).map((u) => (
                <li key={u} className="mono break" translate="no">
                  {u}
                </li>
              ))}
            </ul>
          </dd>
          {net?.uniswapV4 && (
            <>
              <dt>Uniswap v4</dt>
              <dd>
                <ul className="plain-list">
                  {Object.entries(net.uniswapV4).map(([k, v]) => (
                    <li key={k} className="mono break" translate="no">
                      {k}: {v}
                    </li>
                  ))}
                </ul>
              </dd>
            </>
          )}
          {net?.faucets && net.faucets.length > 0 && (
            <>
              <dt>Faucets</dt>
              <dd>
                <ul className="plain-list">
                  {net.faucets.map((u) => (
                    <li key={u}>
                      <a href={u} target="_blank" rel="noreferrer noopener" className="break">
                        {u}
                      </a>
                    </li>
                  ))}
                </ul>
              </dd>
            </>
          )}
        </dl>
      </details>
    </section>
  );
}

function ContractHashRow({ name, hash, path }: { name: string; hash: string; path: string }) {
  return (
    <>
      <dt>{name} ABI</dt>
      <dd className="mono break" translate="no">
        <a href={`./${path}`} target="_blank" rel="noreferrer noopener">
          {path}
        </a>{' '}
        · keccak {hash}
      </dd>
    </>
  );
}

function StatusPill({ ok, label }: { ok: boolean | null; label: string }) {
  const cls = ok === null ? 'pill' : ok ? 'pill pill-ok' : 'pill pill-bad';
  return (
    <span className={cls}>
      <span aria-hidden="true">{ok === null ? '…' : ok ? '✓' : '✕'}</span> {label}
    </span>
  );
}

export function AddressLine({ address, explorer }: { address: string; explorer: string | null }) {
  return (
    <p className="address-line">
      <code className="mono break" translate="no">
        {address}
      </code>
      {explorer && (
        <a href={explorer} target="_blank" rel="noreferrer noopener" className="small">
          View on Explorer ↗
        </a>
      )}
    </p>
  );
}
