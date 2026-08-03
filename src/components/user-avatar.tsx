import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn, initialsOf } from "@/lib/utils";
import type { User } from "@/types";

interface Props {
  user: Pick<User, "firstname" | "lastname" | "avatar_color"> | { firstname: string; lastname: string; avatar_color?: string };
  className?: string;
  size?: "sm" | "md" | "lg";
}

const sizeMap = {
  sm: "h-7 w-7 text-[10px]",
  md: "h-9 w-9 text-xs",
  lg: "h-11 w-11 text-sm",
};

export function UserAvatar({ user, className, size = "md" }: Props) {
  const name = `${user.firstname} ${user.lastname}`;
  return (
    <Avatar className={cn(sizeMap[size], className)}>
      <AvatarFallback className={cn(user.avatar_color ?? "bg-slate-500")}>
        {initialsOf(name)}
      </AvatarFallback>
    </Avatar>
  );
}
