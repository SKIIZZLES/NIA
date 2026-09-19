export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type VideoStatus =
  | 'draft'
  | 'processing'
  | 'published'
  | 'rejected'
  | 'archived'
  | 'deleted';

export type NotificationType = 'like' | 'comment' | 'follow' | 'system' | string;

export type ReportTargetType = 'video' | 'user' | 'comment';
export type ReportStatus = 'open' | 'reviewed' | 'dismissed';

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          username: string | null;
          display_name: string | null;
          bio: string | null;
          avatar_url: string | null;
          created_at: string;
        };
        Insert: {
          id: string;
          username?: string | null;
          display_name?: string | null;
          bio?: string | null;
          avatar_url?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          username?: string | null;
          display_name?: string | null;
          bio?: string | null;
          avatar_url?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      videos: {
        Row: {
          id: string;
          user_id: string;
          storage_path: string;
          thumbnail_url: string | null;
          media_type: 'video' | 'image';
          cover_path: string | null;
          status: VideoStatus;
          category: string | null;
          caption: string | null;
          hashtags: string[] | null;
          region: string | null;
          tag: string | null;
          like_count: number;
          share_count: number;
          save_count: number;
          repost_of: string | null;
          sound_id: string | null;
          event_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          storage_path: string;
          thumbnail_url?: string | null;
          media_type?: 'video' | 'image';
          cover_path?: string | null;
          status?: VideoStatus;
          category?: string | null;
          caption?: string | null;
          hashtags?: string[] | null;
          region?: string | null;
          tag?: string | null;
          like_count?: number;
          share_count?: number;
          save_count?: number;
          repost_of?: string | null;
          sound_id?: string | null;
          event_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          storage_path?: string;
          thumbnail_url?: string | null;
          media_type?: 'video' | 'image';
          cover_path?: string | null;
          status?: VideoStatus;
          category?: string | null;
          caption?: string | null;
          hashtags?: string[] | null;
          region?: string | null;
          tag?: string | null;
          like_count?: number;
          save_count?: number;
          event_id?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'videos_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'videos_repost_of_fkey';
            columns: ['repost_of'];
            isOneToOne: false;
            referencedRelation: 'videos';
            referencedColumns: ['id'];
          },
        ];
      };
      sounds: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          storage_path: string;
          duration_ms: number | null;
          use_count: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          title: string;
          storage_path: string;
          duration_ms?: number | null;
          use_count?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          title?: string;
          storage_path?: string;
          duration_ms?: number | null;
          use_count?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'sounds_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };


      events: {
        Row: {
          id: string;
          title: string;
          description: string | null;
          cover_path: string | null;
          location_text: string | null;
          city: string | null;
          country: string | null;
          starts_at: string;
          ends_at: string | null;
          category: string;
          created_by: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          title: string;
          description?: string | null;
          cover_path?: string | null;
          location_text?: string | null;
          city?: string | null;
          country?: string | null;
          starts_at: string;
          ends_at?: string | null;
          category?: string;
          created_by: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          title?: string;
          description?: string | null;
          cover_path?: string | null;
          location_text?: string | null;
          city?: string | null;
          country?: string | null;
          starts_at?: string;
          ends_at?: string | null;
          category?: string;
          created_by?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'events_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      event_attendees: {
        Row: {
          event_id: string;
          user_id: string;
          status: 'going' | 'interested';
          created_at: string;
        };
        Insert: {
          event_id: string;
          user_id: string;
          status?: 'going' | 'interested';
          created_at?: string;
        };
        Update: {
          event_id?: string;
          user_id?: string;
          status?: 'going' | 'interested';
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'event_attendees_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'events';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'event_attendees_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };

      live_streams: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          description: string | null;
          category: string;
          thumbnail_path: string | null;
          visibility: 'public' | 'followers' | 'private';
          status: 'scheduled' | 'live' | 'ended' | 'cancelled';
          scheduled_at: string | null;
          started_at: string | null;
          ended_at: string | null;
          viewer_count: number;
          provider: string | null;
          provider_stream_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          title: string;
          description?: string | null;
          category?: string;
          thumbnail_path?: string | null;
          visibility?: 'public' | 'followers' | 'private';
          status?: 'scheduled' | 'live' | 'ended' | 'cancelled';
          scheduled_at?: string | null;
          started_at?: string | null;
          ended_at?: string | null;
          viewer_count?: number;
          provider?: string | null;
          provider_stream_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          title?: string;
          description?: string | null;
          category?: string;
          thumbnail_path?: string | null;
          visibility?: 'public' | 'followers' | 'private';
          status?: 'scheduled' | 'live' | 'ended' | 'cancelled';
          scheduled_at?: string | null;
          started_at?: string | null;
          ended_at?: string | null;
          viewer_count?: number;
          provider?: string | null;
          provider_stream_id?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'live_streams_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };


      likes: {
        Row: {
          user_id: string;
          video_id: string;
          created_at: string;
        };
        Insert: {
          user_id: string;
          video_id: string;
          created_at?: string;
        };
        Update: {
          user_id?: string;
          video_id?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'likes_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'likes_video_id_fkey';
            columns: ['video_id'];
            isOneToOne: false;
            referencedRelation: 'videos';
            referencedColumns: ['id'];
          },
        ];
      };

      saves: {
        Row: {
          user_id: string;
          video_id: string;
          created_at: string;
        };
        Insert: {
          user_id: string;
          video_id: string;
          created_at?: string;
        };
        Update: {
          user_id?: string;
          video_id?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'saves_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'saves_video_id_fkey';
            columns: ['video_id'];
            isOneToOne: false;
            referencedRelation: 'videos';
            referencedColumns: ['id'];
          },
        ];
      };
      comments: {
        Row: {
          id: string;
          video_id: string;
          user_id: string;
          body: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          video_id: string;
          user_id: string;
          body: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          video_id?: string;
          user_id?: string;
          body?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'comments_video_id_fkey';
            columns: ['video_id'];
            isOneToOne: false;
            referencedRelation: 'videos';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'comments_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      follows: {
        Row: {
          follower_id: string;
          following_id: string;
          created_at: string;
        };
        Insert: {
          follower_id: string;
          following_id: string;
          created_at?: string;
        };
        Update: {
          follower_id?: string;
          following_id?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'follows_follower_id_fkey';
            columns: ['follower_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'follows_following_id_fkey';
            columns: ['following_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      notifications: {
        Row: {
          id: string;
          user_id: string;
          actor_id: string | null;
          type: string;
          video_id: string | null;
          body: string | null;
          read_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          actor_id?: string | null;
          type: string;
          video_id?: string | null;
          body?: string | null;
          read_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          actor_id?: string | null;
          type?: string;
          video_id?: string | null;
          body?: string | null;
          read_at?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'notifications_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'notifications_actor_id_fkey';
            columns: ['actor_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'notifications_video_id_fkey';
            columns: ['video_id'];
            isOneToOne: false;
            referencedRelation: 'videos';
            referencedColumns: ['id'];
          },
        ];
      };
      reports: {
        Row: {
          id: string;
          reporter_id: string;
          target_type: ReportTargetType;
          target_id: string;
          reason: string;
          status: ReportStatus;
          created_at: string;
        };
        Insert: {
          id?: string;
          reporter_id: string;
          target_type: ReportTargetType;
          target_id: string;
          reason?: string;
          status?: ReportStatus;
          created_at?: string;
        };
        Update: {
          id?: string;
          reporter_id?: string;
          target_type?: ReportTargetType;
          target_id?: string;
          reason?: string;
          status?: ReportStatus;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'reports_reporter_id_fkey';
            columns: ['reporter_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      blocks: {
        Row: {
          blocker_id: string;
          blocked_id: string;
          created_at: string;
        };
        Insert: {
          blocker_id: string;
          blocked_id: string;
          created_at?: string;
        };
        Update: {
          blocker_id?: string;
          blocked_id?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'blocks_blocker_id_fkey';
            columns: ['blocker_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'blocks_blocked_id_fkey';
            columns: ['blocked_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      reposts: {
        Row: {
          user_id: string;
          video_id: string;
          created_at: string;
        };
        Insert: {
          user_id: string;
          video_id: string;
          created_at?: string;
        };
        Update: {
          user_id?: string;
          video_id?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'reposts_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'reposts_video_id_fkey';
            columns: ['video_id'];
            isOneToOne: false;
            referencedRelation: 'videos';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

export type ProfileRow = Database['public']['Tables']['profiles']['Row'];
export type VideoRow = Database['public']['Tables']['videos']['Row'];
export type LikeRow = Database['public']['Tables']['likes']['Row'];
export type CommentRow = Database['public']['Tables']['comments']['Row'];
export type FollowRow = Database['public']['Tables']['follows']['Row'];
export type NotificationRow = Database['public']['Tables']['notifications']['Row'];
export type ReportRow = Database['public']['Tables']['reports']['Row'];
export type BlockRow = Database['public']['Tables']['blocks']['Row'];
export type RepostRow = Database['public']['Tables']['reposts']['Row'];
export type SoundRow = Database['public']['Tables']['sounds']['Row'];
export type EventRow = Database['public']['Tables']['events']['Row'];
export type EventAttendeeRow = Database['public']['Tables']['event_attendees']['Row'];
export type LiveStreamRow = Database['public']['Tables']['live_streams']['Row'];
