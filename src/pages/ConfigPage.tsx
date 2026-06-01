import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useNavigate } from "react-router-dom";
import {
  Link2Off, KeyRound, LogOut, Trash2,
  Eye, EyeOff, AlertTriangle, X, Check
} from "lucide-react";
import { NeonCard } from "../components/NeonCard";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { cn } from "../lib/utils";
import { useConnectionStore } from "../store";
import { supabase } from "../lib/supabase";
import { logger } from "../lib/logger";

// ── Modal de confirmação simples ──────────────────────────────────────────────
const ConfirmModal = ({
  title, message, onConfirm, onCancel, danger = false
}: {
  title: string; message: string;
  onConfirm: () => void; onCancel: () => void; danger?: boolean;
}) => (
  <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
    <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
      className="w-full max-w-sm bg-[#111114] border border-white/10 rounded-2xl p-6 space-y-5 shadow-2xl">
      <div className="flex items-center gap-3">
        <div className={cn("w-10 h-10 rounded-full flex items-center justify-center",
          danger ? "bg-red-500/10" : "bg-amber-500/10")}>
          <AlertTriangle className={cn("w-5 h-5", danger ? "text-red-400" : "text-amber-400")} />
        </div>
        <div>
          <p className="font-black text-white">{title}</p>
          <p className="text-[11px] text-muted-foreground">{message}</p>
        </div>
      </div>
      <div className="flex gap-3">
        <Button variant="outline" onClick={onCancel}
          className="flex-1 border-white/10 text-muted-foreground hover:text-white">
          Não
        </Button>
        <Button onClick={onConfirm}
          className={cn("flex-1 font-black", danger ? "bg-red-600 hover:bg-red-700" : "bg-amber-600 hover:bg-amber-700")}>
          Sim
        </Button>
      </div>
    </motion.div>
  </div>
);

// ── Modal de excluir conta (requer digitar "Delete") ──────────────────────────
const DeleteModal = ({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) => {
  const [value, setValue] = useState("");
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        className="w-full max-w-sm bg-[#111114] border border-red-500/30 rounded-2xl p-6 space-y-5 shadow-2xl">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center shrink-0 mt-0.5">
            <Trash2 className="w-5 h-5 text-red-400" />
          </div>
          <div>
            <p className="font-black text-white">Excluir conta permanentemente</p>
            <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
              Esta acção é irreversível. Todos os teus dados e histórico serão apagados.
              Escreve <span className="text-red-400 font-bold font-mono">Delete</span> para confirmar.
            </p>
          </div>
        </div>
        <Input
          value={value}
          onChange={e => setValue(e.target.value)}
          placeholder="Escreve Delete aqui"
          className="bg-black/40 border-red-500/30 focus:border-red-500/60 font-mono"
        />
        <div className="flex gap-3">
          <Button variant="outline" onClick={onCancel}
            className="flex-1 border-white/10 text-muted-foreground hover:text-white">
            Cancelar
          </Button>
          <Button onClick={onConfirm} disabled={value !== "Delete"}
            className="flex-1 bg-red-600 hover:bg-red-700 font-black disabled:opacity-30">
            Excluir
          </Button>
        </div>
      </motion.div>
    </div>
  );
};

// ── Modal de alterar password ─────────────────────────────────────────────────
const PasswordModal = ({ onClose }: { onClose: () => void }) => {
  const [current, setCurrent] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSave = async () => {
    setError(null);
    if (!current || !newPwd || !confirm) { setError("Preenche todos os campos."); return; }
    if (newPwd !== confirm) { setError("Nova senha e confirmação não coincidem."); return; }
    if (newPwd.length < 6) { setError("A nova senha deve ter pelo menos 6 caracteres."); return; }

    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.email) { setError("Sessão inválida."); return; }

      // Re-autenticar com a senha actual
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: user.email, password: current
      });
      if (signInError) { setError("Senha actual incorrecta."); return; }

      // Actualizar senha
      const { error: updateError } = await supabase.auth.updateUser({ password: newPwd });
      if (updateError) { setError(updateError.message); return; }

      setSuccess(true);
      logger.system("Password alterada com sucesso");
      setTimeout(onClose, 1500);
    } catch (e: any) {
      setError(e.message || "Erro ao alterar senha.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        className="w-full max-w-sm bg-[#111114] border border-white/10 rounded-2xl p-6 space-y-4 shadow-2xl">
        <div className="flex items-center justify-between">
          <p className="font-black text-white flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-purple-400" /> Alterar Senha
          </p>
          <Button variant="ghost" size="icon" onClick={onClose} className="text-muted-foreground h-7 w-7">
            <X className="w-4 h-4" />
          </Button>
        </div>

        {error && <p className="text-[11px] text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 font-bold">{error}</p>}
        {success && <p className="text-[11px] text-green-400 bg-green-500/10 border border-green-500/20 rounded-lg px-3 py-2 font-bold flex items-center gap-2"><Check className="w-3 h-3" /> Senha alterada com sucesso!</p>}

        {[
          { label: "Senha actual", value: current, set: setCurrent, show: showCurrent, toggle: () => setShowCurrent(v => !v) },
          { label: "Nova senha", value: newPwd, set: setNewPwd, show: showNew, toggle: () => setShowNew(v => !v) },
          { label: "Confirmar nova senha", value: confirm, set: setConfirm, show: showNew, toggle: () => {} },
        ].map(({ label, value, set, show, toggle }) => (
          <div key={label} className="space-y-1">
            <label className="text-[10px] text-muted-foreground uppercase font-bold">{label}</label>
            <div className="relative">
              <Input type={show ? "text" : "password"} value={value} onChange={e => set(e.target.value)}
                className="bg-black/40 border-white/10 h-10 pr-10" placeholder="••••••••" />
              {label !== "Confirmar nova senha" && (
                <button type="button" onClick={toggle}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-white">
                  {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              )}
            </div>
          </div>
        ))}

        <Button onClick={handleSave} disabled={loading || success}
          className="w-full bg-purple-600 hover:bg-purple-700 font-black uppercase h-11 mt-2">
          {loading ? "A guardar..." : "Guardar"}
        </Button>
      </motion.div>
    </div>
  );
};

// ── ConfigPage principal ──────────────────────────────────────────────────────
export const ConfigPage = () => {
  const navigate = useNavigate();
  const { signOut, disconnectDeriv, activeAccount, isAuthorized } = useConnectionStore();
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDisconnect = async () => {
    await disconnectDeriv();
    setShowDisconnectConfirm(false);
    logger.system("Conta Deriv desconectada");
    navigate("/");
  };

  const handleLogout = async () => {
    await signOut();
    setShowLogoutConfirm(false);
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Apagar dados do utilizador das tabelas
      await supabase.from("trade_history").delete().eq("user_id", user.id);
      await supabase.from("deriv_connections").delete().eq("user_id", user.id);
      await supabase.from("bot_settings").delete().eq("user_id", user.id);
      await supabase.from("profiles").delete().eq("id", user.id);

      // Fazer logout (conta fica no auth mas dados limpos)
      await signOut();
      logger.system("Conta excluída");
    } catch (e: any) {
      console.error("Delete account error:", e);
    } finally {
      setDeleting(false);
      setShowDeleteModal(false);
    }
  };

  const options = [
    {
      icon: <Link2Off className="w-5 h-5 text-blue-400" />,
      label: "Desconectar Deriv",
      description: activeAccount
        ? `Conta ${activeAccount.account_id} ligada`
        : "Nenhuma conta ligada",
      action: () => setShowDisconnectConfirm(true),
      disabled: !isAuthorized,
      variant: "blue",
    },
    {
      icon: <KeyRound className="w-5 h-5 text-purple-400" />,
      label: "Alterar Senha",
      description: "Muda a tua senha de acesso ao X-ONE",
      action: () => setShowPasswordModal(true),
      variant: "purple",
    },
    {
      icon: <LogOut className="w-5 h-5 text-amber-400" />,
      label: "Terminar Sessão",
      description: "Sair da conta sem apagar dados",
      action: () => setShowLogoutConfirm(true),
      variant: "amber",
    },
    {
      icon: <Trash2 className="w-5 h-5 text-red-400" />,
      label: "Excluir Conta",
      description: "Remove permanentemente todos os teus dados",
      action: () => setShowDeleteModal(true),
      variant: "red",
      danger: true,
    },
  ];

  return (
    <>
      <div className="space-y-6 max-w-lg mx-auto">
        <div>
          <h1 className="text-xl font-black uppercase tracking-widest text-white">Configurações</h1>
          <p className="text-[11px] text-muted-foreground mt-1">Gerir a tua conta X-ONE</p>
        </div>

        <div className="space-y-3">
          {options.map(({ icon, label, description, action, disabled, variant, danger }) => (
            <motion.button
              key={label}
              onClick={disabled ? undefined : action}
              whileTap={disabled ? {} : { scale: 0.99 }}
              className={cn(
                "w-full flex items-center gap-4 p-4 rounded-2xl border text-left transition-all duration-200",
                danger
                  ? "bg-red-500/5 border-red-500/20 hover:bg-red-500/10 hover:border-red-500/40"
                  : variant === "amber"
                  ? "bg-amber-500/5 border-amber-500/20 hover:bg-amber-500/10 hover:border-amber-500/40"
                  : variant === "blue"
                  ? "bg-blue-500/5 border-blue-500/20 hover:bg-blue-500/10 hover:border-blue-500/40"
                  : "bg-purple-500/5 border-purple-500/20 hover:bg-purple-500/10 hover:border-purple-500/40",
                disabled && "opacity-40 cursor-not-allowed"
              )}
            >
              <div className={cn(
                "w-11 h-11 rounded-xl flex items-center justify-center shrink-0",
                danger ? "bg-red-500/10" : variant === "amber" ? "bg-amber-500/10"
                  : variant === "blue" ? "bg-blue-500/10" : "bg-purple-500/10"
              )}>
                {icon}
              </div>
              <div className="flex-1 min-w-0">
                <p className={cn("font-black text-sm",
                  danger ? "text-red-400" : variant === "amber" ? "text-amber-400"
                    : variant === "blue" ? "text-blue-400" : "text-purple-400"
                )}>
                  {label}
                </p>
                <p className="text-[11px] text-muted-foreground truncate">{description}</p>
              </div>
            </motion.button>
          ))}
        </div>
      </div>

      {/* Modais */}
      <AnimatePresence>
        {showDisconnectConfirm && (
          <ConfirmModal
            title="Desconectar Deriv?"
            message="A conexão WebSocket será encerrada. Podes reconectar a qualquer momento."
            onConfirm={handleDisconnect}
            onCancel={() => setShowDisconnectConfirm(false)}
          />
        )}
        {showLogoutConfirm && (
          <ConfirmModal
            title="Terminar sessão?"
            message="Serás redirecionado para o ecrã de login. Os teus dados ficam guardados."
            onConfirm={handleLogout}
            onCancel={() => setShowLogoutConfirm(false)}
            danger
          />
        )}
        {showDeleteModal && (
          <DeleteModal
            onConfirm={handleDelete}
            onCancel={() => setShowDeleteModal(false)}
          />
        )}
        {showPasswordModal && (
          <PasswordModal onClose={() => setShowPasswordModal(false)} />
        )}
      </AnimatePresence>
    </>
  );
};
